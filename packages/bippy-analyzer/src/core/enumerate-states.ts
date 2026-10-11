import { GeneratedSource } from "../compiler/hir/hir.js";
import { DisjointSet } from "../compiler/utils/disjoint-set.js";
import type { Bound, Knowledge } from "./constraints.js";
import {
  CONSTANT_ATOM,
  assume,
  cloneKnowledge,
  dedupeValues,
  evaluate,
  forgetBinding,
  getLengthAtom,
  resolveLiteral,
} from "./constraints.js";
import type {
  AbstractValue,
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  DeadBranch,
  Domain,
  Edge,
  State,
  StateGroup,
  StateReport,
  SymbolicValue,
  Transition,
} from "./types.js";
import { forEachJsxElement, forEachSymbolicValue, mapSymbolicValue } from "./utils/traverse.js";
import { formatNegated, formatSymbolicValue } from "./format.js";
import {
  getBindingPlaceKey,
  getPlaceKey,
  isPlacePrefix,
  parsePlaceKey,
} from "./utils/place-key.js";
import { getTestExpression, getTruthiness } from "./utils/truthiness.js";
import {
  isExternalSource,
  isRenderingNothingWhenFalse,
  isStateBinding,
  isWholeBinding,
} from "./utils/checks.js";

const MAX_ALTERNATIVES = 256;
const REACHABILITY_ROUNDS = 3;

/**
 * One way a render can come out. `decisions` holds every decision outcome taken to reach
 * it, which identifies the state however concrete its values become after a transition.
 */
interface Alternative {
  knowledge: Knowledge;
  render: SymbolicValue;
  fragments: SymbolicValue[];
  assumptions: string[];
  decisions: ReadonlySet<string>;
}

interface PartialChildren extends Omit<Alternative, "render"> {
  children: SymbolicValue[];
}

interface DecisionGroup {
  decisionKeys: Set<string>;
  bindingIds: Set<number>;
  places: string[];
}

const NO_DECISIONS: ReadonlySet<string> = new Set();

const createLeaf = (knowledge: Knowledge, render: SymbolicValue): Alternative => ({
  knowledge,
  render,
  fragments: [],
  assumptions: [],
  decisions: NO_DECISIONS,
});

const getStateKey = (alternative: Alternative): string =>
  [...alternative.decisions].sort().join("|");

type DecisionOutcomes = Map<string, Set<boolean>>;

type FieldCases = AbstractValue[] | "unchanged" | null;

const getDecisionKey = (conditional: ConditionalValue): string => {
  const { decision } = conditional;
  return decision.loc === GeneratedSource
    ? `generated:${decision.terminalId}`
    : `${decision.loc.start}:${decision.loc.end}:${decision.terminalId}`;
};

const getLiteralCases = (
  value: SymbolicValue,
  knowledge: Knowledge | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decided = knowledge ? evaluate(getTestExpression(value), knowledge) : null;
  if (decided !== null)
    return getLiteralCases(decided ? value.consequent : value.alternate, knowledge);
  const consequent = getLiteralCases(value.consequent, knowledge);
  const alternate = getLiteralCases(value.alternate, knowledge);
  return consequent && alternate ? [...consequent, ...alternate] : null;
};

/**
 * Replaces the branches `knowledge` decides with the arm taken, so a test reads as what is
 * still open: `x?.y` once `x != null` is known reads `x.y`.
 */
const simplify = (value: SymbolicValue, knowledge: Knowledge): SymbolicValue =>
  mapSymbolicValue(value, (part) => {
    if (part.kind !== "Conditional") return part;
    const decided = evaluate(getTestExpression(part), knowledge);
    return decided === null ? part : decided ? part.consequent : part.alternate;
  });

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
  if (isWholeBinding(value, binding)) return "unchanged";
  if (value.kind !== "ObjectExpression") return null;
  const [field, ...restPath] = path;
  const assigned = value.properties.findLast((property) => property.key === field);
  if (assigned) return getFieldCases(assigned.value, restPath, binding, knowledge);
  return value.spreads.some((spread) => isWholeBinding(spread, binding)) ? "unchanged" : null;
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
  if (getBindingPlaceKey(value.value) !== placeKey) return null;
  return current.map((candidate): AbstractValue => ({
    kind: "Literal",
    value: getTruthiness(candidate) === "falsy",
  }));
};

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
  const updates = analysis.transitions
    .flatMap((transition) => transition.updates)
    .filter((update) => update.binding.id === binding.id);
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
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const [placeKey, domain] of analysis.placeDomains) {
    const { bindingId, path } = parsePlaceKey(placeKey);
    const binding = bindingsById.get(bindingId);
    const cases =
      binding && isStateBinding(binding)
        ? getReachableCases(analysis, binding, path, domain)
        : domain.kind === "Cases"
          ? domain.cases
          : null;
    if (cases) values.set(placeKey, cases);
  }
  return { values, facts: new Map(), bounds: [] };
};

/**
 * Whether an update keeps the array's length: `items.map(...)` or `[...items]`.
 */
const isLengthPreserving = (value: SymbolicValue, binding: Binding): boolean => {
  if (value.kind === "ArrayMap") return isWholeBinding(value.array, binding);
  return (
    value.kind === "ArrayExpression" &&
    value.elements.length === 0 &&
    value.spreads.length === 1 &&
    isWholeBinding(value.spreads[0], binding)
  );
};

const getLengthBounds = (value: SymbolicValue, binding: Binding): Bound[] => {
  if (value.kind !== "ArrayExpression") return [];
  const lengthAtom = getLengthAtom(binding.id);
  const minimum: Bound = {
    left: CONSTANT_ATOM,
    right: lengthAtom,
    constant: -value.elements.length,
    isStrict: false,
  };
  if (value.spreads.length > 0) return [minimum];
  return [
    minimum,
    {
      left: lengthAtom,
      right: CONSTANT_ATOM,
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
      const { bindingId, path } = parsePlaceKey(placeKey);
      if (bindingId !== update.binding.id) continue;
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

/**
 * Lists every way a render value can come out under what's known. Results are cached per
 * value and knowledge, so a subtree rendered in several places under the same knowledge is
 * listed once and its results stay shared.
 */
const createEnumerator = (
  outcomes: DecisionOutcomes,
  group: DecisionGroup,
): ((value: SymbolicValue, knowledge: Knowledge) => Alternative[]) => {
  const cache = new WeakMap<SymbolicValue, WeakMap<Knowledge, Alternative[]>>();
  const enumerate = (value: SymbolicValue, knowledge: Knowledge): Alternative[] => {
    let cacheByKnowledge = cache.get(value);
    if (!cacheByKnowledge) {
      cacheByKnowledge = new WeakMap();
      cache.set(value, cacheByKnowledge);
    }
    const cached = cacheByKnowledge.get(knowledge);
    if (cached) return cached;
    const alternatives = enumerateUncached(value, knowledge);
    cacheByKnowledge.set(knowledge, alternatives);
    return alternatives;
  };
  const enumerateUncached = (value: SymbolicValue, knowledge: Knowledge): Alternative[] => {
    switch (value.kind) {
      case "Conditional": {
        const key = getDecisionKey(value);
        if (!group.decisionKeys.has(key)) return [createLeaf(knowledge, value)];
        const alternatives: Alternative[] = [];
        const test = getTestExpression(value);
        const isDecided = evaluate(test, knowledge) !== null;
        for (const outcome of [true, false]) {
          const assumed = assume(test, outcome, knowledge);
          if (!assumed) continue;
          outcomes.set(key, new Set([...(outcomes.get(key) ?? []), outcome]));
          const simplified = simplify(test, knowledge);
          const label = outcome ? formatSymbolicValue(simplified) : formatNegated(simplified);
          for (const alternative of enumerate(
            outcome ? value.consequent : value.alternate,
            assumed,
          )) {
            alternatives.push({
              ...alternative,
              fragments: [alternative.render],
              assumptions: isDecided
                ? alternative.assumptions
                : [label, ...alternative.assumptions],
              decisions: new Set([...alternative.decisions, `${key}:${outcome}`]),
            });
          }
        }
        return alternatives;
      }
      case "JsxExpression":
      case "JsxFragment": {
        let partials: PartialChildren[] = [
          { knowledge, children: [], fragments: [], assumptions: [], decisions: NO_DECISIONS },
        ];
        for (const child of value.children) {
          const nextPartials: PartialChildren[] = [];
          for (const partial of partials) {
            for (const childAlternative of enumerate(child, partial.knowledge)) {
              if (nextPartials.length >= MAX_ALTERNATIVES) break;
              nextPartials.push({
                knowledge: childAlternative.knowledge,
                children: [...partial.children, childAlternative.render],
                fragments: [...partial.fragments, ...childAlternative.fragments],
                assumptions: [...partial.assumptions, ...childAlternative.assumptions],
                decisions: new Set([...partial.decisions, ...childAlternative.decisions]),
              });
            }
          }
          partials = nextPartials;
        }
        return partials.map((partial) => ({
          knowledge: partial.knowledge,
          render: { ...value, children: partial.children },
          fragments: partial.fragments,
          assumptions: partial.assumptions,
          decisions: partial.decisions,
        }));
      }
      default:
        return [createLeaf(knowledge, resolveLiteral(value, knowledge))];
    }
  };
  return enumerate;
};

/**
 * Splits the render tree's decisions into groups that vary independently. Decisions join a
 * group when their tests read overlapping places, like `toast` and `toast.cancel`. Fields of
 * a hook result or context value, like `query.isPending` and `query.data`, come from one
 * source and change together, so any field joins the whole value. A call result joins the
 * bindings its arguments read, so `hasPermission(role)` stays with `role`. A decision in
 * another's arm joins it too.
 */
const groupDecisions = (render: SymbolicValue): DecisionGroup[] => {
  const decisionSets = new DisjointSet<string>();
  const decisionKeys: string[] = [];
  const decisionsByAtom = new Map<string, string[]>();
  const places = new Map<string, { name: string; decisionKey: string }>();
  const visit = (value: SymbolicValue, enclosingKey: string | null): void => {
    switch (value.kind) {
      case "Conditional": {
        const key = getDecisionKey(value);
        if (!decisionKeys.includes(key)) decisionKeys.push(key);
        decisionSets.union(enclosingKey ? [key, enclosingKey] : [key]);
        forEachSymbolicValue(getTestExpression(value), (part) => {
          if (part.kind !== "Binding") return;
          const atoms = [
            isExternalSource(part.binding) ? String(part.binding.id) : getBindingPlaceKey(part),
            ...part.binding.inputs,
          ];
          for (const atom of atoms)
            decisionsByAtom.set(atom, [...(decisionsByAtom.get(atom) ?? []), key]);
          places.set(getBindingPlaceKey(part), {
            name: formatSymbolicValue(part),
            decisionKey: key,
          });
        });
        visit(value.consequent, key);
        visit(value.alternate, key);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        for (const child of value.children) visit(child, enclosingKey);
        return;
      default:
        return;
    }
  };
  visit(render, null);
  for (const [atom, keys] of decisionsByAtom)
    for (const [otherAtom, otherKeys] of decisionsByAtom)
      if (isPlacePrefix(atom, otherAtom)) decisionSets.union([...keys, ...otherKeys]);

  const groups = new Map<string, DecisionGroup>();
  const getGroup = (key: string): DecisionGroup => {
    const root = decisionSets.find(key) ?? key;
    const group = groups.get(root) ?? {
      decisionKeys: new Set(),
      bindingIds: new Set(),
      places: [],
    };
    groups.set(root, group);
    return group;
  };
  for (const key of decisionKeys) getGroup(key).decisionKeys.add(key);
  for (const [atom, keys] of decisionsByAtom)
    for (const key of keys) getGroup(key).bindingIds.add(parsePlaceKey(atom).bindingId);
  for (const [placeKey, place] of places) {
    const isNested = [...places.keys()].some(
      (otherKey) => otherKey !== placeKey && isPlacePrefix(otherKey, placeKey),
    );
    const group = getGroup(place.decisionKey);
    if (!isNested && !group.places.includes(place.name)) group.places.push(place.name);
  }
  return groups.size > 0
    ? [...groups.values()]
    : [{ decisionKeys: new Set(), bindingIds: new Set(), places: [] }];
};

const collectTransitionIds = (render: SymbolicValue, transitionIds: Set<string>): void =>
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.transitionId) transitionIds.add(prop.transitionId);
  });

/**
 * Lists the decision outcomes no state reaches. Only the arms some state reaches are
 * searched, and an unreached alternate that renders nothing is not worth reporting.
 */
const collectDeadBranches = (render: SymbolicValue, outcomes: DecisionOutcomes): DeadBranch[] => {
  const deadBranches: DeadBranch[] = [];
  const seen = new Set<string>();
  const visit = (value: SymbolicValue): void => {
    switch (value.kind) {
      case "Conditional": {
        const key = getDecisionKey(value);
        const reached = outcomes.get(key);
        const test = getTestExpression(value);
        if (reached && !seen.has(key)) {
          seen.add(key);
          if (!reached.has(true))
            deadBranches.push({
              decision: value.decision,
              side: true,
              description: `never ${formatSymbolicValue(test)}`,
            });
          if (!reached.has(false) && !isRenderingNothingWhenFalse(value)) {
            deadBranches.push({
              decision: value.decision,
              side: false,
              description: `never ${formatNegated(test)}`,
            });
          }
        }
        if (reached?.has(true)) visit(value.consequent);
        if (reached?.has(false)) visit(value.alternate);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        value.children.forEach(visit);
        return;
      default:
        return;
    }
  };
  visit(render);
  return deadBranches;
};

/**
 * Lists the reachable states of a component, group by group: each consistent way through
 * a group's decisions, with the transitions that change the group and where they lead.
 */
export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachable = createInitialKnowledge(analysis);
  const outcomes: DecisionOutcomes = new Map();
  const decisionGroups = groupDecisions(analysis.render);
  const effectIds = new Set(
    analysis.transitions
      .filter((transition) => transition.trigger.kind === "Effect")
      .map((transition) => transition.id),
  );

  const states: State[] = [];
  const groups: StateGroup[] = [];
  let isTruncated = false;
  decisionGroups.forEach((decisionGroup, groupIndex) => {
    const alternatives = createEnumerator(outcomes, decisionGroup)(analysis.render, reachable);
    isTruncated ||= alternatives.length >= MAX_ALTERNATIVES;
    const firstIndex = states.length;
    const stateKeys = alternatives.map(getStateKey);
    const transitions = analysis.transitions.filter((transition) =>
      transition.updates.some((update) => decisionGroup.bindingIds.has(update.binding.id)),
    );
    for (const alternative of alternatives) {
      const transitionIds = new Set(effectIds);
      collectTransitionIds(alternative.render, transitionIds);
      const edges: Edge[] = transitions
        .filter((transition) => transitionIds.has(transition.id))
        .map((transition) => {
          const targetKeys = new Set(
            applyTransition(transition, alternative.knowledge, reachable).flatMap((after) =>
              createEnumerator(new Map(), decisionGroup)(analysis.render, after).map(getStateKey),
            ),
          );
          return {
            transitionId: transition.id,
            targets: stateKeys.flatMap((stateKey, targetIndex) =>
              targetKeys.has(stateKey) ? [firstIndex + targetIndex] : [],
            ),
            isAsync: transition.updates.some((update) => update.isAsync),
          };
        });
      states.push({
        group: groupIndex,
        assumptions: alternative.assumptions,
        render: alternative.render,
        fragments: alternative.fragments,
        edges,
      });
    }
    groups.push({
      places: decisionGroup.places,
      bindingIds: [...decisionGroup.bindingIds],
      states: alternatives.map((_, index) => firstIndex + index),
    });
  });

  return {
    places: new Map(reachable.values),
    states,
    groups,
    deadBranches: collectDeadBranches(analysis.render, outcomes),
    isTruncated,
  };
};
