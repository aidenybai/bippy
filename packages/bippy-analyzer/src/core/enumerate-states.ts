import DisjointSet from "../react-compiler/Utils/DisjointSet";
import type { Bound, Constraints } from "./constraints";
import {
  assumeCondition,
  cloneConstraints,
  dedupeAbstractValues,
  evaluateCondition,
  forgetBinding,
  getLengthAtom,
  resolveLiteral,
} from "./constraints";
import type {
  AbstractValue,
  Binding,
  BindingValue,
  ComponentAnalysis,
  ConditionalValue,
  JsxContainerValue,
  BindingPlace,
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
import { appendToGroup } from "./utils/group";
import { getValueKey } from "./utils/value-key";
import { getLocationKey } from "./utils/hir";
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
import { isEffectHandler } from "./collect-handlers";

const MAX_ALTERNATIVES = 256;
const MAX_REACHABILITY_ROUNDS = 8;

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

interface BranchTests {
  allBranchKeys: string[];
  branchGroups: DisjointSet<string>;
  branchKeysByPlace: PlaceMap<string[]>;
  testedPlaces: PlaceMap<TestedPlace>;
}

interface KeyedUnreachableBranch extends UnreachableBranch {
  branchKey: string;
}

interface RegionBranches {
  branchKeys: Set<string>;
  bindingIds: Set<number>;
  placeNames: string[];
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

const getBranchKey = (conditional: ConditionalValue): string =>
  `${conditional.branch.file}:${getLocationKey(conditional.branch.loc)}:${conditional.branch.terminalId}`;

const getLiteralCases = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decidedOutcome = constraints
    ? evaluateCondition(getTestExpression(value), constraints)
    : null;
  if (decidedOutcome !== null)
    return getLiteralCases(decidedOutcome ? value.consequent : value.alternate, constraints);
  const consequentCases = getLiteralCases(value.consequent, constraints);
  const alternateCases = getLiteralCases(value.alternate, constraints);
  return consequentCases && alternateCases ? [...consequentCases, ...alternateCases] : null;
};

const simplifyDecidedConditionals = (
  value: SymbolicValue,
  constraints: Constraints,
): SymbolicValue =>
  mapSymbolicValue(value, (part) => {
    if (part.kind !== "Conditional") return part;
    const decidedOutcome = evaluateCondition(getTestExpression(part), constraints);
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
      updated.possibleValues.set(
        place,
        fieldCases ? dedupeAbstractValues(fieldCases) : reachableValues,
      );
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

const getConstraintsAfterHandler = (
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

class StateEnumerator {
  readonly #branchOutcomes: BranchOutcomes;
  readonly #region: RegionBranches;
  readonly #alternativesCache = new WeakMap<SymbolicValue, WeakMap<Constraints, Alternative[]>>();
  #isTruncated = false;

  constructor(branchOutcomes: BranchOutcomes, region: RegionBranches) {
    this.#branchOutcomes = branchOutcomes;
    this.#region = region;
  }

  get isTruncated(): boolean {
    return this.#isTruncated;
  }

  enumerate(value: SymbolicValue, constraints: Constraints): Alternative[] {
    let alternativesByConstraints = this.#alternativesCache.get(value);
    if (!alternativesByConstraints) {
      alternativesByConstraints = new WeakMap();
      this.#alternativesCache.set(value, alternativesByConstraints);
    }
    const cachedAlternatives = alternativesByConstraints.get(constraints);
    if (cachedAlternatives) return cachedAlternatives;
    const alternatives = this.#enumerateUncached(value, constraints);
    alternativesByConstraints.set(constraints, alternatives);
    return alternatives;
  }

  #enumerateUncached(value: SymbolicValue, constraints: Constraints): Alternative[] {
    switch (value.kind) {
      case "Conditional":
        return this.#enumerateBranch(value, constraints);
      case "JsxExpression":
      case "JsxFragment":
        return this.#enumerateChildren(value, constraints);
      default:
        return [createLeaf(constraints, resolveLiteral(value, constraints))];
    }
  }

  #hasRoomFor(alternativeCount: number): boolean {
    if (alternativeCount < MAX_ALTERNATIVES) return true;
    this.#isTruncated = true;
    return false;
  }

  #recordOutcome(branchKey: string, isTrue: boolean): void {
    this.#branchOutcomes.set(
      branchKey,
      new Set([...(this.#branchOutcomes.get(branchKey) ?? []), isTrue]),
    );
  }

  #enumerateBranch(conditional: ConditionalValue, constraints: Constraints): Alternative[] {
    const branchKey = getBranchKey(conditional);
    if (!this.#region.branchKeys.has(branchKey)) return [createLeaf(constraints, conditional)];
    const alternatives: Alternative[] = [];
    const test = getTestExpression(conditional);
    const isDecided = evaluateCondition(test, constraints) !== null;
    for (const isTrue of [true, false]) {
      const withOutcome = assumeCondition(test, isTrue, constraints);
      if (!withOutcome) continue;
      this.#recordOutcome(branchKey, isTrue);
      const simplifiedTest = simplifyDecidedConditionals(test, constraints);
      const conditionLabel = isTrue
        ? formatSymbolicValue(simplifiedTest)
        : formatNegated(simplifiedTest);
      const arm = isTrue ? conditional.consequent : conditional.alternate;
      for (const alternative of this.enumerate(arm, withOutcome)) {
        if (!this.#hasRoomFor(alternatives.length)) break;
        alternatives.push({
          ...alternative,
          fragments: [alternative.render],
          conditions: isDecided
            ? alternative.conditions
            : [conditionLabel, ...alternative.conditions],
          branches: new Set([...alternative.branches, `${branchKey}:${isTrue}`]),
        });
      }
    }
    return alternatives;
  }

  #enumerateChildren(element: JsxContainerValue, constraints: Constraints): Alternative[] {
    let partials: PartialChildren[] = [
      { constraints, children: [], fragments: [], conditions: [], branches: NO_BRANCHES },
    ];
    for (const child of element.children) {
      const nextPartials: PartialChildren[] = [];
      for (const partial of partials) {
        if (!this.#hasRoomFor(nextPartials.length)) break;
        for (const childAlternative of this.enumerate(child, partial.constraints)) {
          if (!this.#hasRoomFor(nextPartials.length)) break;
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
      render: { ...element, children: partial.children },
      fragments: partial.fragments,
      conditions: partial.conditions,
      branches: partial.branches,
    }));
  }
}

const getDecidingPlaces = (testedValue: BindingValue): BindingPlace[] => [
  isExternalSource(testedValue.binding)
    ? getBindingPlace(testedValue.binding)
    : getValuePlace(testedValue),
  ...testedValue.binding.inputPlaces,
];

const collectBranchTests = (render: SymbolicValue): BranchTests => {
  const branchTests: BranchTests = {
    allBranchKeys: [],
    branchGroups: new DisjointSet<string>(),
    branchKeysByPlace: new PlaceMap<string[]>(),
    testedPlaces: new PlaceMap<TestedPlace>(),
  };
  const visitedEnclosingKeys = new WeakMap<SymbolicValue, Set<string | null>>();
  const visit = (value: SymbolicValue, enclosingKey: string | null): void => {
    const enclosingKeys = visitedEnclosingKeys.get(value) ?? new Set();
    if (enclosingKeys.has(enclosingKey)) return;
    visitedEnclosingKeys.set(value, enclosingKeys.add(enclosingKey));
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment") {
      for (const child of value.children) visit(child, enclosingKey);
      return;
    }
    if (value.kind !== "Conditional") return;
    const branchKey = getBranchKey(value);
    if (!branchTests.allBranchKeys.includes(branchKey)) branchTests.allBranchKeys.push(branchKey);
    branchTests.branchGroups.union(enclosingKey ? [branchKey, enclosingKey] : [branchKey]);
    forEachSymbolicValue(getTestExpression(value), (part) => {
      if (part.kind !== "Binding") return;
      for (const place of getDecidingPlaces(part))
        branchTests.branchKeysByPlace.set(place, [
          ...(branchTests.branchKeysByPlace.get(place) ?? []),
          branchKey,
        ]);
      branchTests.testedPlaces.set(getValuePlace(part), {
        name: formatSymbolicValue(part),
        branchKey,
      });
    });
    visit(value.consequent, branchKey);
    visit(value.alternate, branchKey);
  };
  visit(render, null);
  for (const [place, branchKeys] of branchTests.branchKeysByPlace)
    for (const [otherPlace, otherBranchKeys] of branchTests.branchKeysByPlace)
      if (isPlacePrefix(place, otherPlace))
        branchTests.branchGroups.union([...branchKeys, ...otherBranchKeys]);
  return branchTests;
};

const createEmptyRegion = (): RegionBranches => ({
  branchKeys: new Set(),
  bindingIds: new Set(),
  placeNames: [],
});

const groupIntoRegions = (branchTests: BranchTests): RegionBranches[] => {
  const regionsByGroup = new Map<string, RegionBranches>();
  const getRegion = (branchKey: string): RegionBranches => {
    const groupKey = branchTests.branchGroups.find(branchKey) ?? branchKey;
    const region = regionsByGroup.get(groupKey) ?? createEmptyRegion();
    regionsByGroup.set(groupKey, region);
    return region;
  };
  for (const branchKey of branchTests.allBranchKeys) getRegion(branchKey).branchKeys.add(branchKey);
  for (const [place, branchKeys] of branchTests.branchKeysByPlace)
    for (const branchKey of branchKeys) getRegion(branchKey).bindingIds.add(place.bindingId);
  const testedPlaces = branchTests.testedPlaces.places();
  for (const [place, { name, branchKey }] of branchTests.testedPlaces) {
    const isNested = testedPlaces.some(
      (otherPlace) => !isSamePlace(otherPlace, place) && isPlacePrefix(otherPlace, place),
    );
    const region = getRegion(branchKey);
    if (!isNested && !region.placeNames.includes(name)) region.placeNames.push(name);
  }
  return regionsByGroup.size > 0 ? [...regionsByGroup.values()] : [createEmptyRegion()];
};

const findRegions = (render: SymbolicValue): RegionBranches[] =>
  groupIntoRegions(collectBranchTests(render));

const collectHandlerIds = (render: SymbolicValue): Set<string> => {
  const handlerIds = new Set<string>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });
  return handlerIds;
};

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

const getUnreachedSides = (
  conditional: ConditionalValue,
  branchKey: string,
  reachedOutcomes: Set<boolean>,
): KeyedUnreachableBranch[] => {
  const test = getTestExpression(conditional);
  const unreachedSides: KeyedUnreachableBranch[] = [];
  if (!reachedOutcomes.has(true))
    unreachedSides.push({
      branchKey,
      branch: conditional.branch,
      isTrueSide: true,
      description: `never ${formatSymbolicValue(test)}`,
    });
  if (!reachedOutcomes.has(false) && !isRenderingNothingWhenFalse(conditional))
    unreachedSides.push({
      branchKey,
      branch: conditional.branch,
      isTrueSide: false,
      description: `never ${formatNegated(test)}`,
    });
  return unreachedSides;
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
          unreachableBranches.push(...getUnreachedSides(value, branchKey, reachedOutcomes));
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

interface TransitionContext {
  analysis: ComponentAnalysis;
  reachableConstraints: Constraints;
  dependentsByBinding: Map<number, number[]>;
  targetEnumerator: StateEnumerator;
  regionStateKeys: string[];
  firstStateIndex: number;
}

const getRegionHandlers = (analysis: ComponentAnalysis, region: RegionBranches): Handler[] =>
  analysis.handlers.filter((handler) =>
    handler.updates.some((update) => region.bindingIds.has(update.binding.id)),
  );

const getTransition = (
  handler: Handler,
  alternative: Alternative,
  context: TransitionContext,
): Transition => {
  const targetKeys = new Set(
    getConstraintsAfterHandler(
      handler,
      alternative.constraints,
      context.reachableConstraints,
      context.dependentsByBinding,
    ).flatMap((afterHandler) =>
      context.targetEnumerator.enumerate(context.analysis.render, afterHandler).map(getStateKey),
    ),
  );
  return {
    handlerId: handler.id,
    targets: context.regionStateKeys.flatMap((stateKey, regionStateIndex) =>
      targetKeys.has(stateKey) ? [context.firstStateIndex + regionStateIndex] : [],
    ),
    isAsync: handler.updates.some((update) => update.isAsync),
  };
};

export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachableConstraints = createInitialConstraints(analysis);
  const dependentsByBinding = getDependentsByBinding(analysis.bindings);
  const branchOutcomes: BranchOutcomes = new Map();
  const effectIds = new Set(analysis.handlers.filter(isEffectHandler).map((handler) => handler.id));
  const states: State[] = [];
  const regions: Region[] = [];
  let isTruncated = false;
  findRegions(analysis.render).forEach((region, regionIndex) => {
    const enumerator = new StateEnumerator(branchOutcomes, region);
    const alternatives = enumerator.enumerate(analysis.render, reachableConstraints);
    const transitionContext: TransitionContext = {
      analysis,
      reachableConstraints,
      dependentsByBinding,
      targetEnumerator: new StateEnumerator(new Map(), region),
      regionStateKeys: alternatives.map(getStateKey),
      firstStateIndex: states.length,
    };
    const regionHandlers = getRegionHandlers(analysis, region);
    for (const alternative of alternatives) {
      const renderedHandlerIds = new Set([...effectIds, ...collectHandlerIds(alternative.render)]);
      states.push({
        regionIndex,
        conditions: alternative.conditions,
        render: alternative.render,
        fragments: alternative.fragments,
        transitions: regionHandlers
          .filter((handler) => renderedHandlerIds.has(handler.id))
          .map((handler) => getTransition(handler, alternative, transitionContext)),
      });
    }
    isTruncated ||= enumerator.isTruncated || transitionContext.targetEnumerator.isTruncated;
    regions.push({
      placeNames: region.placeNames,
      bindingIds: [...region.bindingIds],
      states: alternatives.map(
        (_alternative, regionStateIndex) => transitionContext.firstStateIndex + regionStateIndex,
      ),
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
