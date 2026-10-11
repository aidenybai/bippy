import { GeneratedSource } from "../react-compiler/HIR/HIR.js";
import DisjointSet from "../react-compiler/Utils/DisjointSet.js";
import type { Bound, Constraints } from "./constraints.js";
import {
  CONSTANT_ATOM,
  assume,
  cloneConstraints,
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
  UnreachableBranch,
  Domain,
  Transition,
  State,
  Region,
  StateReport,
  SymbolicValue,
  Handler,
  StateUpdate,
} from "./types.js";
import {
  forEachJsxElement,
  forEachRenderNode,
  forEachSymbolicValue,
  mapSymbolicValue,
} from "./utils/traverse.js";
import { formatNegated, formatSymbolicValue } from "./format.js";
import {
  getBindingPlaceKey,
  getPlaceKey,
  isPlacePrefix,
  parsePlaceKey,
} from "./utils/place-key.js";
import { getTestExpression, getTruthiness, negate } from "./utils/truthiness.js";
import {
  isExternalSource,
  isRenderingNothingWhenFalse,
  isStateBinding,
  isWholeBinding,
} from "./utils/checks.js";

const MAX_ALTERNATIVES = 256;
const REACHABILITY_ROUNDS = 3;

/**
 * One way a render can come out. `branches` holds every branch outcome taken to reach
 * it, which identifies the state however concrete its values become after a transition.
 */
interface Alternative {
  constraints: Constraints;
  render: SymbolicValue;
  fragments: SymbolicValue[];
  conditions: string[];
  branches: ReadonlySet<string>;
}

interface PartialChildren extends Omit<Alternative, "render"> {
  children: SymbolicValue[];
}

interface RegionBranches {
  branchKeys: Set<string>;
  bindingIds: Set<number>;
  places: string[];
}

const NO_DECISIONS: ReadonlySet<string> = new Set();

const createLeaf = (constraints: Constraints, render: SymbolicValue): Alternative => ({
  constraints,
  render,
  fragments: [],
  conditions: [],
  branches: NO_DECISIONS,
});

const getStateKey = (alternative: Alternative): string =>
  [...alternative.branches].sort().join("|");

type DecisionOutcomes = Map<string, Set<boolean>>;

type FieldCases = AbstractValue[] | "unchanged" | null;

const getBranchKey = (conditional: ConditionalValue): string => {
  const { branch } = conditional;
  return branch.loc === GeneratedSource
    ? `generated:${branch.terminalId}`
    : `${branch.loc.start.index}:${branch.loc.end.index}:${branch.terminalId}`;
};

const getLiteralCases = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decided = constraints ? evaluate(getTestExpression(value), constraints) : null;
  if (decided !== null)
    return getLiteralCases(decided ? value.consequent : value.alternate, constraints);
  const consequent = getLiteralCases(value.consequent, constraints);
  const alternate = getLiteralCases(value.alternate, constraints);
  return consequent && alternate ? [...consequent, ...alternate] : null;
};

/**
 * Replaces the branches `constraints` decides with the arm taken, so a test reads as what is
 * still open: `x?.y` once `x != null` is known reads `x.y`.
 */
const simplify = (value: SymbolicValue, constraints: Constraints): SymbolicValue =>
  mapSymbolicValue(value, (part) => {
    if (part.kind !== "Conditional") return part;
    const decided = evaluate(getTestExpression(part), constraints);
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
  constraints: Constraints | null,
): FieldCases => {
  if (!value) return null;
  if (path.length === 0) return getLiteralCases(value, constraints);
  if (isWholeBinding(value, binding)) return "unchanged";
  if (value.kind !== "ObjectExpression") return null;
  const [field, ...restPath] = path;
  const assigned = value.properties.findLast((property) => property.key === field);
  if (assigned) return getFieldCases(assigned.value, restPath, binding, constraints);
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
 * handlers assign, repeated until nothing new appears. Falls back to the type's cases
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
  const updates = analysis.handlers
    .flatMap((handler) => handler.updates)
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

const createInitialKnowledge = (analysis: ComponentAnalysis): Constraints => {
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
  return { values, assumptions: new Map(), bounds: [] };
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

/**
 * The call results each binding feeds, directly or through other results, like
 * `locales.filter(...)` for the `query` its callback reads.
 */
const getDependents = (bindings: Binding[]): Map<number, number[]> => {
  const dependents = new Map<number, number[]>();
  for (const binding of bindings)
    for (const input of binding.inputs) {
      const { bindingId } = parsePlaceKey(input);
      dependents.set(bindingId, [...(dependents.get(bindingId) ?? []), binding.id]);
    }
  const collect = (bindingId: number, collected: Set<number>): Set<number> => {
    for (const dependentId of dependents.get(bindingId) ?? [])
      if (!collected.has(dependentId)) collect(dependentId, collected.add(dependentId));
    return collected;
  };
  return new Map(
    [...dependents.keys()].map((bindingId) => [bindingId, [...collect(bindingId, new Set())]]),
  );
};

const applyUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  reachable: Constraints,
  dependents: Map<number, number[]>,
): Constraints => {
  const next = cloneConstraints(constraints);
  for (const update of updates) {
    for (const placeKey of reachable.values.keys()) {
      const { bindingId, path } = parsePlaceKey(placeKey);
      if (bindingId !== update.binding.id) continue;
      const current = constraints.values.get(placeKey);
      const cases =
        getFieldCases(update.value, path, update.binding, constraints) ??
        getToggleCases(update.value, placeKey, current);
      if (cases === "unchanged") continue;
      next.values.set(
        placeKey,
        cases ? dedupeValues(cases) : (reachable.values.get(placeKey) ?? []),
      );
    }
    forgetBinding(next, update.binding.id, isLengthPreserving(update.value, update.binding));
    next.bounds.push(...getLengthBounds(update.value, update.binding));
    const dependentIds = new Set(dependents.get(update.binding.id));
    for (const [placeKey, values] of reachable.values)
      if (dependentIds.has(parsePlaceKey(placeKey).bindingId)) next.values.set(placeKey, values);
    for (const dependentId of dependentIds) forgetBinding(next, dependentId, false);
  }
  return next;
};

const getGuardKeys = (update: StateUpdate): string[] => update.guards.map(formatSymbolicValue);

const isGuardPrefix = (prefix: string[], guardKeys: string[]): boolean =>
  prefix.every((guardKey, index) => guardKeys[index] === guardKey);

/**
 * The constraints after a handler runs, one for each path through it. A path is the guards
 * its last update ran under, and it takes the updates made on the way there, so updates on
 * different paths, like `return setOpen(true)` in one branch and `setOpen(false)` in
 * another, stay apart. A guarded update may not happen, so a guarded handler also keeps the
 * constraints it started from.
 */
const applyTransition = (
  handler: Handler,
  constraints: Constraints,
  reachable: Constraints,
  dependents: Map<number, number[]>,
): Constraints[] => {
  const pathGuardKeys = new Map(
    handler.updates.map((update) => {
      const guardKeys = getGuardKeys(update);
      return [guardKeys.join("\0"), guardKeys];
    }),
  );
  const applied = [...pathGuardKeys.values()].map((guardKeys) =>
    applyUpdates(
      handler.updates.filter((update) => isGuardPrefix(getGuardKeys(update), guardKeys)),
      constraints,
      reachable,
      dependents,
    ),
  );
  return handler.updates.some((update) => update.guards.length > 0)
    ? [constraints, ...applied]
    : applied;
};

/**
 * Lists every way a render value can come out under what's known. Results are cached per
 * value and constraints, so a subtree rendered in several places under the same constraints is
 * listed once and its results stay shared.
 */
const createEnumerator = (
  outcomes: DecisionOutcomes,
  region: RegionBranches,
): ((value: SymbolicValue, constraints: Constraints) => Alternative[]) => {
  const cache = new WeakMap<SymbolicValue, WeakMap<Constraints, Alternative[]>>();
  const enumerate = (value: SymbolicValue, constraints: Constraints): Alternative[] => {
    let cacheByKnowledge = cache.get(value);
    if (!cacheByKnowledge) {
      cacheByKnowledge = new WeakMap();
      cache.set(value, cacheByKnowledge);
    }
    const cached = cacheByKnowledge.get(constraints);
    if (cached) return cached;
    const alternatives = enumerateUncached(value, constraints);
    cacheByKnowledge.set(constraints, alternatives);
    return alternatives;
  };
  const enumerateUncached = (value: SymbolicValue, constraints: Constraints): Alternative[] => {
    switch (value.kind) {
      case "Conditional": {
        const key = getBranchKey(value);
        if (!region.branchKeys.has(key)) return [createLeaf(constraints, value)];
        const alternatives: Alternative[] = [];
        const test = getTestExpression(value);
        const isDecided = evaluate(test, constraints) !== null;
        for (const outcome of [true, false]) {
          const assumed = assume(test, outcome, constraints);
          if (!assumed) continue;
          outcomes.set(key, new Set([...(outcomes.get(key) ?? []), outcome]));
          const simplified = simplify(test, constraints);
          const label = outcome ? formatSymbolicValue(simplified) : formatNegated(simplified);
          for (const alternative of enumerate(
            outcome ? value.consequent : value.alternate,
            assumed,
          )) {
            alternatives.push({
              ...alternative,
              fragments: [alternative.render],
              conditions: isDecided ? alternative.conditions : [label, ...alternative.conditions],
              branches: new Set([...alternative.branches, `${key}:${outcome}`]),
            });
          }
        }
        return alternatives;
      }
      case "JsxExpression":
      case "JsxFragment": {
        let partials: PartialChildren[] = [
          { constraints, children: [], fragments: [], conditions: [], branches: NO_DECISIONS },
        ];
        for (const child of value.children) {
          const nextPartials: PartialChildren[] = [];
          for (const partial of partials) {
            for (const childAlternative of enumerate(child, partial.constraints)) {
              if (nextPartials.length >= MAX_ALTERNATIVES) break;
              nextPartials.push({
                constraints: childAlternative.constraints,
                children: [...partial.children, childAlternative.render],
                fragments: [...partial.fragments, ...childAlternative.fragments],
                conditions: [...partial.conditions, ...childAlternative.conditions],
                branches: new Set([...partial.branches, ...childAlternative.branches]),
              });
            }
          }
          partials = nextPartials;
        }
        return partials.map((partial) => ({
          constraints: partial.constraints,
          render: { ...value, children: partial.children },
          fragments: partial.fragments,
          conditions: partial.conditions,
          branches: partial.branches,
        }));
      }
      default:
        return [createLeaf(constraints, resolveLiteral(value, constraints))];
    }
  };
  return enumerate;
};

/**
 * Splits the render tree's branches into regions that vary independently. Branches join a
 * region when their tests read overlapping places, like `toast` and `toast.cancel`. Fields of
 * a hook result or context value, like `query.isPending` and `query.data`, come from one
 * source and change together, so any field joins the whole value. A call result joins the
 * bindings its arguments read, so `hasPermission(role)` stays with `role`. A branch in
 * another's arm joins it too.
 */
const findRegions = (render: SymbolicValue): RegionBranches[] => {
  const decisionSets = new DisjointSet<string>();
  const branchKeys: string[] = [];
  const decisionsByAtom = new Map<string, string[]>();
  const places = new Map<string, { name: string; branchKey: string }>();
  const visited = new WeakMap<SymbolicValue, Set<string | null>>();
  const visit = (value: SymbolicValue, enclosingKey: string | null): void => {
    const enclosingKeys = visited.get(value) ?? new Set();
    if (enclosingKeys.has(enclosingKey)) return;
    visited.set(value, enclosingKeys.add(enclosingKey));
    switch (value.kind) {
      case "Conditional": {
        const key = getBranchKey(value);
        if (!branchKeys.includes(key)) branchKeys.push(key);
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
            branchKey: key,
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

  const regions = new Map<string, RegionBranches>();
  const getGroup = (key: string): RegionBranches => {
    const root = decisionSets.find(key) ?? key;
    const region = regions.get(root) ?? {
      branchKeys: new Set(),
      bindingIds: new Set(),
      places: [],
    };
    regions.set(root, region);
    return region;
  };
  for (const key of branchKeys) getGroup(key).branchKeys.add(key);
  for (const [atom, keys] of decisionsByAtom)
    for (const key of keys) getGroup(key).bindingIds.add(parsePlaceKey(atom).bindingId);
  for (const [placeKey, place] of places) {
    const isNested = [...places.keys()].some(
      (otherKey) => otherKey !== placeKey && isPlacePrefix(otherKey, placeKey),
    );
    const region = getGroup(place.branchKey);
    if (!isNested && !region.places.includes(place.name)) region.places.push(place.name);
  }
  return regions.size > 0
    ? [...regions.values()]
    : [{ branchKeys: new Set(), bindingIds: new Set(), places: [] }];
};

const collectHandlerIds = (render: SymbolicValue, handlerIds: Set<string>): void =>
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });

/**
 * The branches inside other branches' tests, like the `?.` of `if (!getOption(value)?.icon)`.
 * States don't decide them, so either side may run.
 */
const collectTestedBranchKeys = (render: SymbolicValue): Set<string> => {
  const keys = new Set<string>();
  forEachRenderNode(render, (value) => {
    if (value.kind !== "Conditional") return;
    forEachSymbolicValue(getTestExpression(value), (part) => {
      if (part.kind === "Conditional") keys.add(getBranchKey(part));
    });
  });
  return keys;
};

/**
 * Lists the branch outcomes no state reaches. Only the arms some state reaches are
 * searched, and an unreached alternate that renders nothing is not worth reporting. A
 * branch rendered under a condition it wasn't computed under, like a ternary kept in a
 * variable that renders only behind `&&`, still runs without that condition, so the
 * states that render it say nothing about the side it takes.
 */
const collectUnreachableBranches = (
  render: SymbolicValue,
  outcomes: DecisionOutcomes,
  branchGuards: WeakMap<ConditionalValue, string[]>,
): UnreachableBranch[] => {
  const unreachableBranches: Array<UnreachableBranch & { key: string }> = [];
  const seen = collectTestedBranchKeys(render);
  const narrowedKeys = new Set<string>();
  const pathConditions = new WeakMap<SymbolicValue, Set<string>>();
  const visit = (value: SymbolicValue, conditions: string[]): void => {
    const known = pathConditions.get(value);
    if (known && conditions.every((condition) => known.has(condition))) return;
    const merged = new Set([...(known ?? []), ...conditions]);
    pathConditions.set(value, merged);
    switch (value.kind) {
      case "Conditional": {
        const key = getBranchKey(value);
        const guards = branchGuards.get(value) ?? [];
        if ([...merged].some((condition) => !guards.includes(condition))) narrowedKeys.add(key);
        const reached = outcomes.get(key);
        const test = getTestExpression(value);
        if (reached && !seen.has(key)) {
          seen.add(key);
          if (!reached.has(true))
            unreachableBranches.push({
              key,
              branch: value.branch,
              side: true,
              description: `never ${formatSymbolicValue(test)}`,
            });
          if (!reached.has(false) && !isRenderingNothingWhenFalse(value)) {
            unreachableBranches.push({
              key,
              branch: value.branch,
              side: false,
              description: `never ${formatNegated(test)}`,
            });
          }
        }
        if (reached?.has(true)) visit(value.consequent, [...merged, formatSymbolicValue(test)]);
        if (reached?.has(false))
          visit(value.alternate, [...merged, formatSymbolicValue(negate(test))]);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        for (const child of value.children) visit(child, [...merged]);
        return;
      default:
        return;
    }
  };
  visit(render, []);
  return unreachableBranches.flatMap(({ key, ...unreachableBranch }) =>
    narrowedKeys.has(key) ? [] : [unreachableBranch],
  );
};

/**
 * Lists the reachable states of a component, region by region: each consistent way through
 * a region's branches, with the handlers that change the region and where they lead.
 */
export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachable = createInitialKnowledge(analysis);
  const dependents = getDependents(analysis.bindings);
  const outcomes: DecisionOutcomes = new Map();
  const regionBranches = findRegions(analysis.render);
  const effectIds = new Set(
    analysis.handlers
      .filter((handler) => handler.trigger.kind === "Effect")
      .map((handler) => handler.id),
  );

  const states: State[] = [];
  const regions: Region[] = [];
  let isTruncated = false;
  regionBranches.forEach((regionBranch, regionIndex) => {
    const alternatives = createEnumerator(outcomes, regionBranch)(analysis.render, reachable);
    isTruncated ||= alternatives.length >= MAX_ALTERNATIVES;
    const firstIndex = states.length;
    const stateKeys = alternatives.map(getStateKey);
    const handlers = analysis.handlers.filter((handler) =>
      handler.updates.some((update) => regionBranch.bindingIds.has(update.binding.id)),
    );
    for (const alternative of alternatives) {
      const handlerIds = new Set(effectIds);
      collectHandlerIds(alternative.render, handlerIds);
      const transitions: Transition[] = handlers
        .filter((handler) => handlerIds.has(handler.id))
        .map((handler) => {
          const targetKeys = new Set(
            applyTransition(handler, alternative.constraints, reachable, dependents).flatMap(
              (after) =>
                createEnumerator(new Map(), regionBranch)(analysis.render, after).map(getStateKey),
            ),
          );
          return {
            handlerId: handler.id,
            targets: stateKeys.flatMap((stateKey, targetIndex) =>
              targetKeys.has(stateKey) ? [firstIndex + targetIndex] : [],
            ),
            isAsync: handler.updates.some((update) => update.isAsync),
          };
        });
      states.push({
        region: regionIndex,
        conditions: alternative.conditions,
        render: alternative.render,
        fragments: alternative.fragments,
        transitions,
      });
    }
    regions.push({
      places: regionBranch.places,
      bindingIds: [...regionBranch.bindingIds],
      states: alternatives.map((_, index) => firstIndex + index),
    });
  });

  return {
    places: new Map(reachable.values),
    states,
    regions,
    unreachableBranches: collectUnreachableBranches(
      analysis.render,
      outcomes,
      analysis.branchGuards,
    ),
    isTruncated,
  };
};
