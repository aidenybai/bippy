import { getBindingUpdates } from "./collect-handlers";
import { dedupeAbstractValues, evaluateCondition, getLengthAtom } from "./constraints";
import type { Bound, Constraints } from "./constraints";
import { getFieldCases } from "./field-cases";
import type {
  AbstractValue,
  Binding,
  BindingPlace,
  ComponentAnalysis,
  Domain,
  SymbolicValue,
} from "./types";
import { appendToGroup } from "./utils/append-to-group";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getBindingPlace } from "./utils/get-binding-place";
import { getTruthiness } from "./utils/get-truthiness";
import { getValuePlace } from "./utils/get-value-place";
import { isNullish } from "./utils/is-nullish";
import { isSamePlace } from "./utils/is-same-place";
import { isStateBinding } from "./utils/is-state-binding";
import { isWholeBinding } from "./utils/is-whole-binding";
import { PlaceMap } from "./utils/place-map";
import type { FirstRenderOutcomes } from "./state-enumerator";

const MAX_REACHABILITY_ROUNDS = 8;

export interface ReachabilityContext {
  analysis: ComponentAnalysis;
  reachableConstraints: Constraints;
  dependentsByBinding: Map<number, number[]>;
}

export const getToggleCases = (
  value: SymbolicValue,
  place: BindingPlace,
  currentValues: AbstractValue[] | undefined,
): AbstractValue[] | null => {
  if (
    !currentValues ||
    value.kind !== "UnaryExpression" ||
    value.operator !== "!" ||
    value.value.kind !== "Binding"
  )
    return null;
  if (!isSamePlace(getValuePlace(value.value), place)) return null;
  return currentValues.map((currentValue): AbstractValue => ({
    kind: "Literal",
    value: getTruthiness(currentValue) === "falsy",
  }));
};

const hasCastPart = (value: SymbolicValue): boolean => {
  let isCast = false;
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Unknown" && part.reason === "cast") isCast = true;
  });
  return isCast;
};

const getReachableCases = (
  analysis: ComponentAnalysis,
  binding: Binding,
  path: string[],
  domain: Domain,
): AbstractValue[] | null => {
  const typeCases = domain.kind === "Cases" ? domain.cases : null;
  const updates = getBindingUpdates(analysis.handlers, binding);
  const isUntypedState =
    typeCases?.every((value) => value.kind === "Literal" && isNullish(value.value)) ?? false;
  if (isUntypedState && updates.length > 0) return null;
  if (updates.some((update) => hasCastPart(update.value))) return null;
  const initialCases = getFieldCases(binding.initial, path, binding, null);
  if (!Array.isArray(initialCases)) return typeCases;
  let reachable = dedupeAbstractValues(initialCases);
  const place = getBindingPlace(binding, path);
  for (let round = 0; round < MAX_REACHABILITY_ROUNDS; round++) {
    const previousCount = reachable.length;
    for (const update of updates) {
      const updateCases =
        getFieldCases(update.value, path, binding, null) ??
        getToggleCases(update.value, place, reachable);
      if (updateCases === "unchanged") continue;
      if (!updateCases) return typeCases;
      reachable = dedupeAbstractValues([...reachable, ...updateCases]);
    }
    if (reachable.length === previousCount) return reachable;
  }
  return typeCases;
};

const getLengthLimitBounds = (binding: Binding): Bound[] => {
  if (!binding.lengthLimit) return [];
  const { arrayLength, isSameLength } = binding.lengthLimit;
  const resultLength = getLengthAtom(binding.id);
  const isNoLonger: Bound = {
    left: resultLength,
    right: arrayLength,
    maxDifference: 0,
    isStrict: false,
  };
  const isNoShorter: Bound = {
    left: arrayLength,
    right: resultLength,
    maxDifference: 0,
    isStrict: false,
  };
  return isSameLength ? [isNoLonger, isNoShorter] : [isNoLonger];
};

export const createInitialConstraints = (analysis: ComponentAnalysis): Constraints => {
  const possibleValues = new PlaceMap<AbstractValue[]>();
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const [place, domain] of analysis.placeDomains) {
    const binding = bindingsById.get(place.bindingId);
    const cases =
      binding && isStateBinding(binding)
        ? getReachableCases(analysis, binding, place.path, domain)
        : domain.kind === "Cases"
          ? domain.cases
          : null;
    if (cases) possibleValues.set(place, cases);
  }
  return {
    possibleValues,
    assumptions: new Map(),
    bounds: [],
    boundGraph: null,
    invariants: analysis.bindings.flatMap(getLengthLimitBounds),
    unionMemberValues: analysis.unionMemberValues,
    possibleMembers: new Map(),
  };
};

export const createFirstRenderConstraints = (
  analysis: ComponentAnalysis,
  reachableConstraints: Constraints,
): Constraints => {
  const possibleValues = reachableConstraints.possibleValues.clone();
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const [place] of analysis.placeDomains) {
    const binding = bindingsById.get(place.bindingId);
    if (!binding || !isStateBinding(binding)) continue;
    const initialCases = getFieldCases(binding.initial, place.path, binding, null);
    if (Array.isArray(initialCases)) possibleValues.set(place, dedupeAbstractValues(initialCases));
  }
  return { ...reachableConstraints, possibleValues };
};

export const getFirstRenderOutcome = (
  firstRender: FirstRenderOutcomes,
  branchKey: string,
  test: SymbolicValue,
): boolean | null => {
  const cachedOutcome = firstRender.outcomesByBranchKey.get(branchKey);
  if (cachedOutcome !== undefined) return cachedOutcome;
  const outcome = evaluateCondition(test, firstRender.constraints);
  firstRender.outcomesByBranchKey.set(branchKey, outcome);
  return outcome;
};

export const isLengthPreserving = (value: SymbolicValue, binding: Binding): boolean => {
  if (value.kind === "ArrayMap") return isWholeBinding(value.array, binding);
  return (
    value.kind === "ArrayExpression" &&
    value.elements.length === 0 &&
    value.spreads.length === 1 &&
    isWholeBinding(value.spreads[0], binding)
  );
};

export const getLengthBounds = (value: SymbolicValue, binding: Binding): Bound[] => {
  if (value.kind !== "ArrayExpression") return [];
  const lengthAtom = getLengthAtom(binding.id);
  const isAtLeastElementCount: Bound = {
    left: null,
    right: lengthAtom,
    maxDifference: -value.elements.length,
    isStrict: false,
  };
  if (value.spreads.length > 0) return [isAtLeastElementCount];
  const isAtMostElementCount: Bound = {
    left: lengthAtom,
    right: null,
    maxDifference: value.elements.length,
    isStrict: false,
  };
  return [isAtLeastElementCount, isAtMostElementCount];
};

export const getDependentsByBinding = (bindings: Binding[]): Map<number, number[]> => {
  const directDependents = new Map<number, number[]>();
  for (const binding of bindings)
    for (const { bindingId } of binding.inputPlaces)
      appendToGroup(directDependents, bindingId, binding.id);
  const collectTransitively = (bindingId: number, collected: Set<number>): Set<number> => {
    for (const dependentId of directDependents.get(bindingId) ?? [])
      if (!collected.has(dependentId)) collectTransitively(dependentId, collected.add(dependentId));
    return collected;
  };
  return new Map(
    [...directDependents.keys()].map((bindingId) => [
      bindingId,
      [...collectTransitively(bindingId, new Set())],
    ]),
  );
};
