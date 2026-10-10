import { assertExhaustive } from "../utils/utils.js";
import type { Bound, Knowledge } from "./knowledge.js";
import {
  CONSTANT_BOUND_ATOM,
  assume,
  cloneKnowledge,
  createKnowledge,
  dedupeValues,
  evaluate,
  forgetBinding,
  getLengthAtom,
  resolveLiteral,
} from "./knowledge.js";
import type {
  AbstractValue,
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  DeadBranch,
  Domain,
  Edge,
  State,
  StateReport,
  SymbolicValue,
  Transition,
} from "./types.js";
import { formatNegated, formatSymbolicValue, getPlaceKey, getTruthiness } from "./values.js";

const MAX_ALTERNATIVES = 256;
const REACHABILITY_ROUNDS = 3;

interface Alternative {
  knowledge: Knowledge;
  render: SymbolicValue;
  assumptions: string[];
}

type DecisionOutcomes = Map<string, Set<boolean>>;

type FieldCases = AbstractValue[] | "unchanged" | null;

const getDecisionKey = (conditional: ConditionalValue): string => {
  const { decision } = conditional;
  return typeof decision.loc === "symbol"
    ? `generated:${decision.terminalId}`
    : `${decision.loc.start}:${decision.loc.end}:${decision.terminalId}`;
};

const getTest = (conditional: ConditionalValue): SymbolicValue =>
  conditional.testKind === "nullish"
    ? {
        kind: "BinaryExpression",
        operator: "!=",
        left: conditional.test,
        right: { kind: "Primitive", value: null },
      }
    : conditional.test;

const getLiteralCases = (
  value: SymbolicValue,
  knowledge: Knowledge | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decided = knowledge ? evaluate(getTest(value), knowledge) : null;
  if (decided !== null)
    return getLiteralCases(decided ? value.consequent : value.alternate, knowledge);
  const consequent = getLiteralCases(value.consequent, knowledge);
  const alternate = getLiteralCases(value.alternate, knowledge);
  return consequent && alternate ? [...consequent, ...alternate] : null;
};

const isSameBinding = (value: SymbolicValue, binding: Binding): boolean =>
  value.kind === "Binding" && value.binding.id === binding.id && value.path.length === 0;

/**
 * The values an update assigns to `path` within `binding`, or `"unchanged"` when it keeps
 * the current value, as in `{ ...state, other: 1 }`.
 */
const getFieldCases = (
  value: SymbolicValue | null,
  path: string[],
  binding: Binding,
  knowledge: Knowledge | null,
): FieldCases => {
  if (!value) return null;
  if (path.length === 0) return getLiteralCases(value, knowledge);
  if (isSameBinding(value, binding)) return "unchanged";
  if (value.kind !== "ObjectExpression") return null;
  const [field, ...restPath] = path;
  const assigned = value.properties.findLast((property) => property.key === field);
  if (assigned) return getFieldCases(assigned.value, restPath, binding, knowledge);
  return value.spreads.some((spread) => isSameBinding(spread, binding)) ? "unchanged" : null;
};

const getToggleCases = (
  value: SymbolicValue,
  placeKey: string,
  current: AbstractValue[] | undefined,
): AbstractValue[] | null => {
  if (
    !current ||
    value.kind !== "UnaryExpression" ||
    value.operator !== "!" ||
    value.value.kind !== "Binding"
  )
    return null;
  if (getPlaceKey(value.value.binding, value.value.path) !== placeKey) return null;
  return current.map((candidate): AbstractValue => ({
    kind: "Literal",
    value: getTruthiness(candidate) === "falsy",
  }));
};

const getPlacePath = (placeKey: string, binding: Binding): string[] | null => {
  const [bindingId, ...path] = placeKey.split(".");
  return bindingId === String(binding.id) ? path : null;
};

const getUpdatesOf = (analysis: ComponentAnalysis, binding: Binding) =>
  analysis.transitions
    .flatMap((transition) => transition.updates)
    .filter((update) => update.binding.id === binding.id);

/**
 * Every value a place of a state binding can reach: its initial value plus whatever the
 * transitions assign, repeated until nothing new appears. Falls back to the type's cases
 * when an update assigns something the analysis can't list.
 */
const getReachableCases = (
  analysis: ComponentAnalysis,
  binding: Binding,
  path: string[],
  domain: Domain,
): AbstractValue[] | null => {
  const typeCases = domain.kind === "Cases" ? domain.cases : null;
  const initialCases = getFieldCases(binding.initial, path, binding, null);
  if (!Array.isArray(initialCases)) return typeCases;
  let reachable = dedupeValues(initialCases);
  const placeKey = getPlaceKey(binding, path);
  const updates = getUpdatesOf(analysis, binding);
  for (let round = 0; round < REACHABILITY_ROUNDS; round++) {
    for (const update of updates) {
      const cases =
        getFieldCases(update.value, path, binding, null) ??
        getToggleCases(update.value, placeKey, reachable);
      if (cases === "unchanged") continue;
      if (!cases) return typeCases;
      reachable = dedupeValues([...reachable, ...cases]);
    }
  }
  return reachable;
};

const createInitialKnowledge = (analysis: ComponentAnalysis): Knowledge => {
  const values = new Map<string, AbstractValue[]>();
  const bindingsById = new Map(analysis.bindings.map((binding) => [String(binding.id), binding]));
  for (const [placeKey, domain] of analysis.placeDomains) {
    const [bindingId = "", ...path] = placeKey.split(".");
    const binding = bindingsById.get(bindingId);
    const isStateLike = binding?.kind === "state" || binding?.kind === "reducer";
    const cases =
      binding && isStateLike
        ? getReachableCases(analysis, binding, path, domain)
        : domain.kind === "Cases"
          ? domain.cases
          : null;
    if (cases) values.set(placeKey, cases);
  }
  return createKnowledge(values);
};

const isLengthPreserving = (value: SymbolicValue, binding: Binding): boolean => {
  if (value.kind === "ArrayMap") return isSameBinding(value.array, binding);
  const [spread] = value.kind === "ArrayExpression" ? value.spreads : [];
  return (
    value.kind === "ArrayExpression" &&
    value.elements.length === 0 &&
    value.spreads.length === 1 &&
    spread !== undefined &&
    isSameBinding(spread, binding)
  );
};

const getLengthBounds = (value: SymbolicValue, binding: Binding): Bound[] => {
  if (value.kind !== "ArrayExpression") return [];
  const lengthAtom = getLengthAtom(binding.id);
  const minimum: Bound = {
    left: CONSTANT_BOUND_ATOM,
    right: lengthAtom,
    constant: -value.elements.length,
    isStrict: false,
  };
  if (value.spreads.length > 0) return [minimum];
  return [
    minimum,
    {
      left: lengthAtom,
      right: CONSTANT_BOUND_ATOM,
      constant: value.elements.length,
      isStrict: false,
    },
  ];
};

const applyUpdates = (
  transition: Transition,
  knowledge: Knowledge,
  reachable: Knowledge,
): Knowledge => {
  const next = cloneKnowledge(knowledge);
  for (const update of transition.updates) {
    for (const placeKey of reachable.values.keys()) {
      const path = getPlacePath(placeKey, update.binding);
      if (!path) continue;
      const current = knowledge.values.get(placeKey);
      const cases =
        getFieldCases(update.value, path, update.binding, knowledge) ??
        getToggleCases(update.value, placeKey, current);
      if (cases === "unchanged") continue;
      next.values.set(
        placeKey,
        cases ? dedupeValues(cases) : (reachable.values.get(placeKey) ?? []),
      );
    }
    forgetBinding(next, update.binding.id, isLengthPreserving(update.value, update.binding));
    next.bounds.push(...getLengthBounds(update.value, update.binding));
  }
  return next;
};

/**
 * The knowledge after a transition. A guarded update may not happen, so a guarded
 * transition also keeps the knowledge it started from.
 */
const applyTransition = (
  transition: Transition,
  knowledge: Knowledge,
  reachable: Knowledge,
): Knowledge[] => {
  const applied = applyUpdates(transition, knowledge, reachable);
  return transition.updates.some((update) => update.guards.length > 0)
    ? [knowledge, applied]
    : [applied];
};

const enumerate = (
  value: SymbolicValue,
  knowledge: Knowledge,
  outcomes: DecisionOutcomes,
): Alternative[] => {
  switch (value.kind) {
    case "Conditional": {
      const alternatives: Alternative[] = [];
      const test = getTest(value);
      const isDecided = evaluate(test, knowledge) !== null;
      const key = getDecisionKey(value);
      for (const outcome of [true, false]) {
        const assumed = assume(test, outcome, knowledge);
        if (!assumed) continue;
        outcomes.set(key, new Set([...(outcomes.get(key) ?? []), outcome]));
        const label = outcome ? formatSymbolicValue(test) : formatNegated(test);
        for (const alternative of enumerate(
          outcome ? value.consequent : value.alternate,
          assumed,
          outcomes,
        )) {
          alternatives.push({
            ...alternative,
            assumptions: isDecided ? alternative.assumptions : [label, ...alternative.assumptions],
          });
        }
      }
      return alternatives;
    }
    case "JsxExpression":
    case "JsxFragment": {
      let partials: Alternative[] = [
        { knowledge, render: { ...value, children: [] }, assumptions: [] },
      ];
      for (const child of value.children) {
        const nextPartials: Alternative[] = [];
        for (const partial of partials) {
          for (const childAlternative of enumerate(child, partial.knowledge, outcomes)) {
            if (nextPartials.length >= MAX_ALTERNATIVES) break;
            const children =
              partial.render.kind === "JsxExpression" || partial.render.kind === "JsxFragment"
                ? partial.render.children
                : [];
            nextPartials.push({
              knowledge: childAlternative.knowledge,
              render: { ...value, children: [...children, childAlternative.render] },
              assumptions: [...partial.assumptions, ...childAlternative.assumptions],
            });
          }
        }
        partials = nextPartials;
      }
      return partials;
    }
    default:
      return [{ knowledge, render: resolveLiteral(value, knowledge), assumptions: [] }];
  }
};

const collectTransitionIds = (value: SymbolicValue, transitionIds: Set<string>): void => {
  switch (value.kind) {
    case "JsxExpression":
      for (const prop of value.props)
        if (prop.kind === "JsxAttribute" && prop.transitionId) transitionIds.add(prop.transitionId);
      for (const child of value.children) collectTransitionIds(child, transitionIds);
      return;
    case "JsxFragment":
      for (const child of value.children) collectTransitionIds(child, transitionIds);
      return;
    case "Conditional":
      collectTransitionIds(value.consequent, transitionIds);
      collectTransitionIds(value.alternate, transitionIds);
      return;
    case "ArrayMap":
      collectTransitionIds(value.item, transitionIds);
      return;
    default:
      return;
  }
};

const isRenderingNothing = (value: SymbolicValue, test: SymbolicValue): boolean =>
  (value.kind === "Primitive" &&
    (value.value === null || value.value === undefined || value.value === false)) ||
  formatSymbolicValue(value) === formatSymbolicValue(test);

const collectDeadBranches = (
  value: SymbolicValue,
  outcomes: DecisionOutcomes,
  deadBranches: DeadBranch[],
  seen: Set<string>,
): void => {
  switch (value.kind) {
    case "Conditional": {
      const key = getDecisionKey(value);
      const reached = outcomes.get(key);
      const test = getTest(value);
      if (reached && !seen.has(key)) {
        seen.add(key);
        if (!reached.has(true))
          deadBranches.push({
            decision: value.decision,
            side: true,
            description: `never ${formatSymbolicValue(test)}`,
          });
        if (!reached.has(false) && !isRenderingNothing(value.alternate, value.test)) {
          deadBranches.push({
            decision: value.decision,
            side: false,
            description: `never ${formatNegated(test)}`,
          });
        }
      }
      if (reached?.has(true)) collectDeadBranches(value.consequent, outcomes, deadBranches, seen);
      if (reached?.has(false)) collectDeadBranches(value.alternate, outcomes, deadBranches, seen);
      return;
    }
    case "JsxExpression":
    case "JsxFragment":
      for (const child of value.children) collectDeadBranches(child, outcomes, deadBranches, seen);
      return;
    default:
      return;
  }
};

const getRenderSignature = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "JsxExpression":
      return `<${value.tag.name}>${value.children.map(getRenderSignature).join("")}</>`;
    case "JsxFragment":
      return `<>${value.children.map(getRenderSignature).join("")}</>`;
    case "Conditional":
      return `{${formatSymbolicValue(value.test)}?${getRenderSignature(value.consequent)}:${getRenderSignature(value.alternate)}}`;
    case "ArrayMap":
      return `[${getRenderSignature(value.item)}]`;
    case "Primitive":
    case "Binding":
    case "BinaryExpression":
    case "UnaryExpression":
    case "ObjectExpression":
    case "ArrayExpression":
    case "JSXText":
    case "Function":
    case "Setter":
    case "Dispatch":
    case "Props":
    case "HookResult":
    case "Global":
    case "Unknown":
      return formatSymbolicValue(value);
    default:
      return assertExhaustive(value, "Unhandled symbolic value");
  }
};

/**
 * Lists the reachable states of a component: each consistent way through the decisions in
 * its render tree, with the transitions available in that state and where they lead.
 */
export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachable = createInitialKnowledge(analysis);
  const outcomes: DecisionOutcomes = new Map();
  const alternatives = enumerate(analysis.render, reachable, outcomes);
  const signatures = alternatives.map((alternative) => getRenderSignature(alternative.render));
  const effectIds = new Set(
    analysis.transitions
      .filter((transition) => transition.trigger.kind === "Effect")
      .map((transition) => transition.id),
  );

  const states = alternatives.map((alternative): State => {
    const transitionIds = new Set(effectIds);
    collectTransitionIds(alternative.render, transitionIds);
    const edges: Edge[] = analysis.transitions
      .filter((transition) => transitionIds.has(transition.id) && transition.updates.length > 0)
      .map((transition) => {
        const targetSignatures = new Set(
          applyTransition(transition, alternative.knowledge, reachable).flatMap((after) =>
            enumerate(analysis.render, after, new Map()).map((target) =>
              getRenderSignature(target.render),
            ),
          ),
        );
        return {
          transitionId: transition.id,
          targets: signatures.flatMap((signature, targetIndex) =>
            targetSignatures.has(signature) ? [targetIndex] : [],
          ),
          isAsync: transition.updates.some((update) => update.isAsync),
        };
      });
    return { assumptions: alternative.assumptions, render: alternative.render, edges };
  });

  const deadBranches: DeadBranch[] = [];
  collectDeadBranches(analysis.render, outcomes, deadBranches, new Set());
  const places = new Map([...reachable.values].map(([placeKey, values]) => [placeKey, values]));
  return { places, states, deadBranches, isTruncated: alternatives.length >= MAX_ALTERNATIVES };
};
