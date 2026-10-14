import { GeneratedSource } from "../react-compiler/HIR/HIR";
import DisjointSet from "../react-compiler/Utils/DisjointSet";
import type { Bound, Constraints } from "./constraints";
import {
  assume,
  cloneConstraints,
  dedupeValues,
  evaluate,
  forgetBinding,
  getLengthAtom,
  resolveLiteral,
} from "./constraints";
import type {
  AbstractValue,
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  Place,
  UnreachableBranch,
  Domain,
  Transition,
  State,
  Region,
  StateReport,
  SymbolicValue,
  Handler,
  StateUpdate,
} from "./types";
import {
  forEachJsxElement,
  forEachRenderNode,
  forEachSymbolicValue,
  mapSymbolicValue,
} from "./utils/traverse";
import { formatNegated, formatSymbolicValue } from "./format";
import { getValueKey } from "./utils/value-key";
import {
  PlaceMap,
  getBindingPlace,
  getValuePlace,
  isPlacePrefix,
  isSamePlace,
} from "./utils/place";
import { getTestExpression, getTruthiness, negate } from "./utils/truthiness";
import {
  isExternalSource,
  isRenderingNothingWhenFalse,
  isStateBinding,
  isWholeBinding,
} from "./utils/checks";

const MAX_ALTERNATIVES = 256;
const MAX_REACHABILITY_ROUNDS = 8;

interface Enumerator {
  enumerate: (value: SymbolicValue, constraints: Constraints) => Alternative[];
  getIsTruncated: () => boolean;
}

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

interface TestedPlace {
  name: string;
  branchKey: string;
}

interface KeyedUnreachableBranch extends UnreachableBranch {
  branchKey: string;
}

interface RegionBranches {
  branchKeys: Set<string>;
  bindingIds: Set<number>;
  places: string[];
}

const NO_BRANCHES: ReadonlySet<string> = new Set();

const createLeaf = (constraints: Constraints, render: SymbolicValue): Alternative => ({
  constraints,
  render,
  fragments: [],
  conditions: [],
  branches: NO_BRANCHES,
});

const getStateKey = (alternative: Alternative): string =>
  [...alternative.branches].sort().join("|");

interface BranchOutcomes extends Map<string, Set<boolean>> {}

type FieldCases = AbstractValue[] | "unchanged" | null;

const getBranchKey = (conditional: ConditionalValue): string => {
  const { branch } = conditional;
  return branch.loc === GeneratedSource
    ? `${branch.file}:generated:${branch.terminalId}`
    : `${branch.file}:${branch.loc.start.index}:${branch.loc.end.index}:${branch.terminalId}`;
};

const getLiteralCases = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decidedOutcome = constraints ? evaluate(getTestExpression(value), constraints) : null;
  if (decidedOutcome !== null)
    return getLiteralCases(decidedOutcome ? value.consequent : value.alternate, constraints);
  const consequentCases = getLiteralCases(value.consequent, constraints);
  const alternateCases = getLiteralCases(value.alternate, constraints);
  return consequentCases && alternateCases ? [...consequentCases, ...alternateCases] : null;
};

const simplify = (value: SymbolicValue, constraints: Constraints): SymbolicValue =>
  mapSymbolicValue(value, (part) => {
    if (part.kind !== "Conditional") return part;
    const decidedOutcome = evaluate(getTestExpression(part), constraints);
    if (decidedOutcome === null) return part;
    return decidedOutcome ? part.consequent : part.alternate;
  });

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
  const assignedProperty = value.properties.findLast((property) => property.key === field);
  if (assignedProperty)
    return getFieldCases(assignedProperty.value, restPath, binding, constraints);
  return value.spreads.some((spread) => isWholeBinding(spread, binding)) ? "unchanged" : null;
};

const getToggleCases = (
  value: SymbolicValue,
  place: Place,
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

const getReachableCases = (
  analysis: ComponentAnalysis,
  binding: Binding,
  path: string[],
  domain: Domain,
): AbstractValue[] | null => {
  const typeCases = domain.kind === "Cases" ? domain.cases : null;
  const updates = analysis.handlers
    .flatMap((handler) => handler.updates)
    .filter((update) => update.binding.id === binding.id);
  // HACK: an untyped `useState()` is typed `undefined` though handlers set it, so ignore its type.
  const isUntypedState =
    typeCases?.every((value) => value.kind === "Literal" && value.value === undefined) ?? false;
  if (isUntypedState && updates.length > 0) return null;
  const initialCases = getFieldCases(binding.initial, path, binding, null);
  if (!Array.isArray(initialCases)) return typeCases;
  let reachable = dedupeValues(initialCases);
  const place = getBindingPlace(binding, path);
  for (let round = 0; round < MAX_REACHABILITY_ROUNDS; round++) {
    const previousCount = reachable.length;
    for (const update of updates) {
      const updateCases =
        getFieldCases(update.value, path, binding, null) ??
        getToggleCases(update.value, place, reachable);
      if (updateCases === "unchanged") continue;
      if (!updateCases) return typeCases;
      reachable = dedupeValues([...reachable, ...updateCases]);
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

const createInitialConstraints = (analysis: ComponentAnalysis): Constraints => {
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
    invariants: analysis.bindings.flatMap(getLengthLimitBounds),
    unionMemberValues: analysis.unionMemberValues,
    possibleMembers: new Map(),
  };
};

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

const getDependentsByBinding = (bindings: Binding[]): Map<number, number[]> => {
  const directDependents = new Map<number, number[]>();
  for (const binding of bindings)
    for (const { bindingId } of binding.inputPlaces)
      directDependents.set(bindingId, [...(directDependents.get(bindingId) ?? []), binding.id]);
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

const applyUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  reachableConstraints: Constraints,
  dependentsByBinding: Map<number, number[]>,
): Constraints => {
  const updated = cloneConstraints(constraints);
  for (const update of updates) {
    for (const [place, reachableValues] of reachableConstraints.possibleValues) {
      if (place.bindingId !== update.binding.id) continue;
      const currentValues = constraints.possibleValues.get(place);
      const fieldCases =
        getFieldCases(update.value, place.path, update.binding, constraints) ??
        getToggleCases(update.value, place, currentValues);
      if (fieldCases === "unchanged") continue;
      updated.possibleValues.set(place, fieldCases ? dedupeValues(fieldCases) : reachableValues);
    }
    forgetBinding(updated, update.binding.id, isLengthPreserving(update.value, update.binding));
    updated.bounds.push(...getLengthBounds(update.value, update.binding));
    const dependentIds = new Set(dependentsByBinding.get(update.binding.id));
    for (const [place, reachableValues] of reachableConstraints.possibleValues)
      if (dependentIds.has(place.bindingId)) updated.possibleValues.set(place, reachableValues);
    for (const dependentId of dependentIds) forgetBinding(updated, dependentId, false);
  }
  return updated;
};

const getGuardKeys = (update: StateUpdate): string[] => update.guards.map(getValueKey);

const isGuardPrefix = (prefix: string[], guardKeys: string[]): boolean =>
  prefix.every((guardKey, index) => guardKeys[index] === guardKey);

const applyTransition = (
  handler: Handler,
  constraints: Constraints,
  reachableConstraints: Constraints,
  dependentsByBinding: Map<number, number[]>,
): Constraints[] => {
  const guardKeysByPath = new Map(
    handler.updates.map((update) => {
      const guardKeys = getGuardKeys(update);
      return [guardKeys.join("\0"), guardKeys];
    }),
  );
  const afterEachPath = [...guardKeysByPath.values()].map((guardKeys) =>
    applyUpdates(
      handler.updates.filter((update) => isGuardPrefix(getGuardKeys(update), guardKeys)),
      constraints,
      reachableConstraints,
      dependentsByBinding,
    ),
  );
  const mayChangeNothing = handler.updates.some((update) => update.guards.length > 0);
  return mayChangeNothing ? [constraints, ...afterEachPath] : afterEachPath;
};

const createEnumerator = (branchOutcomes: BranchOutcomes, region: RegionBranches): Enumerator => {
  let isTruncated = false;
  const alternativesCache = new WeakMap<SymbolicValue, WeakMap<Constraints, Alternative[]>>();
  const enumerate = (value: SymbolicValue, constraints: Constraints): Alternative[] => {
    let alternativesByConstraints = alternativesCache.get(value);
    if (!alternativesByConstraints) {
      alternativesByConstraints = new WeakMap();
      alternativesCache.set(value, alternativesByConstraints);
    }
    const cachedAlternatives = alternativesByConstraints.get(constraints);
    if (cachedAlternatives) return cachedAlternatives;
    const alternatives = enumerateUncached(value, constraints);
    alternativesByConstraints.set(constraints, alternatives);
    return alternatives;
  };
  const enumerateUncached = (value: SymbolicValue, constraints: Constraints): Alternative[] => {
    switch (value.kind) {
      case "Conditional": {
        const branchKey = getBranchKey(value);
        if (!region.branchKeys.has(branchKey)) return [createLeaf(constraints, value)];
        const alternatives: Alternative[] = [];
        const test = getTestExpression(value);
        const isDecided = evaluate(test, constraints) !== null;
        for (const outcome of [true, false]) {
          const withOutcome = assume(test, outcome, constraints);
          if (!withOutcome) continue;
          branchOutcomes.set(
            branchKey,
            new Set([...(branchOutcomes.get(branchKey) ?? []), outcome]),
          );
          const simplifiedTest = simplify(test, constraints);
          const conditionLabel = outcome
            ? formatSymbolicValue(simplifiedTest)
            : formatNegated(simplifiedTest);
          for (const alternative of enumerate(
            outcome ? value.consequent : value.alternate,
            withOutcome,
          )) {
            if (alternatives.length >= MAX_ALTERNATIVES) {
              isTruncated = true;
              break;
            }
            alternatives.push({
              ...alternative,
              fragments: [alternative.render],
              conditions: isDecided
                ? alternative.conditions
                : [conditionLabel, ...alternative.conditions],
              branches: new Set([...alternative.branches, `${branchKey}:${outcome}`]),
            });
          }
        }
        return alternatives;
      }
      case "JsxExpression":
      case "JsxFragment": {
        let partials: PartialChildren[] = [
          { constraints, children: [], fragments: [], conditions: [], branches: NO_BRANCHES },
        ];
        for (const child of value.children) {
          const nextPartials: PartialChildren[] = [];
          for (const partial of partials) {
            if (nextPartials.length >= MAX_ALTERNATIVES) {
              isTruncated = true;
              break;
            }
            for (const childAlternative of enumerate(child, partial.constraints)) {
              if (nextPartials.length >= MAX_ALTERNATIVES) {
                isTruncated = true;
                break;
              }
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
  return { enumerate, getIsTruncated: () => isTruncated };
};

const findRegions = (render: SymbolicValue): RegionBranches[] => {
  const branchGroups = new DisjointSet<string>();
  const allBranchKeys: string[] = [];
  const branchKeysByPlace = new PlaceMap<string[]>();
  const testedPlaces = new PlaceMap<TestedPlace>();
  const visited = new WeakMap<SymbolicValue, Set<string | null>>();
  const visit = (value: SymbolicValue, enclosingKey: string | null): void => {
    const enclosingKeys = visited.get(value) ?? new Set();
    if (enclosingKeys.has(enclosingKey)) return;
    visited.set(value, enclosingKeys.add(enclosingKey));
    switch (value.kind) {
      case "Conditional": {
        const branchKey = getBranchKey(value);
        if (!allBranchKeys.includes(branchKey)) allBranchKeys.push(branchKey);
        branchGroups.union(enclosingKey ? [branchKey, enclosingKey] : [branchKey]);
        forEachSymbolicValue(getTestExpression(value), (part) => {
          if (part.kind !== "Binding") return;
          const decidingPlaces = [
            isExternalSource(part.binding) ? getBindingPlace(part.binding) : getValuePlace(part),
            ...part.binding.inputPlaces,
          ];
          for (const place of decidingPlaces)
            branchKeysByPlace.set(place, [...(branchKeysByPlace.get(place) ?? []), branchKey]);
          testedPlaces.set(getValuePlace(part), { name: formatSymbolicValue(part), branchKey });
        });
        visit(value.consequent, branchKey);
        visit(value.alternate, branchKey);
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
  for (const [place, branchKeys] of branchKeysByPlace)
    for (const [otherPlace, otherBranchKeys] of branchKeysByPlace)
      if (isPlacePrefix(place, otherPlace)) branchGroups.union([...branchKeys, ...otherBranchKeys]);

  const regionsByGroup = new Map<string, RegionBranches>();
  const getRegion = (branchKey: string): RegionBranches => {
    const groupKey = branchGroups.find(branchKey) ?? branchKey;
    const region = regionsByGroup.get(groupKey) ?? {
      branchKeys: new Set(),
      bindingIds: new Set(),
      places: [],
    };
    regionsByGroup.set(groupKey, region);
    return region;
  };
  for (const branchKey of allBranchKeys) getRegion(branchKey).branchKeys.add(branchKey);
  for (const [place, branchKeys] of branchKeysByPlace)
    for (const branchKey of branchKeys) getRegion(branchKey).bindingIds.add(place.bindingId);
  for (const [place, { name, branchKey }] of testedPlaces) {
    const isNested = testedPlaces
      .places()
      .some((otherPlace) => !isSamePlace(otherPlace, place) && isPlacePrefix(otherPlace, place));
    const region = getRegion(branchKey);
    if (!isNested && !region.places.includes(name)) region.places.push(name);
  }
  return regionsByGroup.size > 0
    ? [...regionsByGroup.values()]
    : [{ branchKeys: new Set(), bindingIds: new Set(), places: [] }];
};

const collectHandlerIds = (render: SymbolicValue, handlerIds: Set<string>): void =>
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });

const collectBranchKeysInTests = (render: SymbolicValue): Set<string> => {
  const branchKeysInTests = new Set<string>();
  forEachRenderNode(render, (value) => {
    if (value.kind !== "Conditional") return;
    forEachSymbolicValue(getTestExpression(value), (part) => {
      if (part.kind === "Conditional") branchKeysInTests.add(getBranchKey(part));
    });
  });
  return branchKeysInTests;
};

const collectUnreachableBranches = (
  render: SymbolicValue,
  branchOutcomes: BranchOutcomes,
): UnreachableBranch[] => {
  const unreachableBranches: KeyedUnreachableBranch[] = [];
  const reportedKeys = collectBranchKeysInTests(render);
  const displacedKeys = new Set<string>();
  const conditionsByValue = new WeakMap<SymbolicValue, Set<string>>();
  const visit = (value: SymbolicValue, conditions: string[]): void => {
    const knownConditions = conditionsByValue.get(value);
    if (knownConditions && conditions.every((condition) => knownConditions.has(condition))) return;
    const pathConditions = new Set([...(knownConditions ?? []), ...conditions]);
    conditionsByValue.set(value, pathConditions);
    switch (value.kind) {
      case "Conditional": {
        const branchKey = getBranchKey(value);
        const isRenderedOutsideItsGuards = [...pathConditions].some(
          (condition) => !value.guardKeys.includes(condition),
        );
        if (isRenderedOutsideItsGuards) displacedKeys.add(branchKey);
        const reachedOutcomes = branchOutcomes.get(branchKey);
        const test = getTestExpression(value);
        if (reachedOutcomes && !reportedKeys.has(branchKey)) {
          reportedKeys.add(branchKey);
          if (!reachedOutcomes.has(true))
            unreachableBranches.push({
              branchKey,
              branch: value.branch,
              side: true,
              description: `never ${formatSymbolicValue(test)}`,
            });
          if (!reachedOutcomes.has(false) && !isRenderingNothingWhenFalse(value)) {
            unreachableBranches.push({
              branchKey,
              branch: value.branch,
              side: false,
              description: `never ${formatNegated(test)}`,
            });
          }
        }
        if (reachedOutcomes?.has(true))
          visit(value.consequent, [...pathConditions, getValueKey(test)]);
        if (reachedOutcomes?.has(false))
          visit(value.alternate, [...pathConditions, getValueKey(negate(test))]);
        return;
      }
      case "JsxExpression":
      case "JsxFragment":
        for (const child of value.children) visit(child, [...pathConditions]);
        return;
      default:
        return;
    }
  };
  visit(render, []);
  return unreachableBranches.flatMap(({ branchKey, ...unreachableBranch }) =>
    displacedKeys.has(branchKey) ? [] : [unreachableBranch],
  );
};

export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachableConstraints = createInitialConstraints(analysis);
  const dependentsByBinding = getDependentsByBinding(analysis.bindings);
  const branchOutcomes: BranchOutcomes = new Map();
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
    const enumerator = createEnumerator(branchOutcomes, regionBranch);
    const targetEnumerator = createEnumerator(new Map(), regionBranch);
    const alternatives = enumerator.enumerate(analysis.render, reachableConstraints);
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
            applyTransition(
              handler,
              alternative.constraints,
              reachableConstraints,
              dependentsByBinding,
            ).flatMap((afterTransition) =>
              targetEnumerator.enumerate(analysis.render, afterTransition).map(getStateKey),
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
    isTruncated ||= enumerator.getIsTruncated() || targetEnumerator.getIsTruncated();
    regions.push({
      places: regionBranch.places,
      bindingIds: [...regionBranch.bindingIds],
      states: alternatives.map((_alternative, index) => firstIndex + index),
    });
  });

  return {
    places: new PlaceMap(reachableConstraints.possibleValues),
    states,
    regions,
    unreachableBranches: isTruncated
      ? []
      : collectUnreachableBranches(analysis.render, branchOutcomes),
    isTruncated,
  };
};
