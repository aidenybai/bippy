import type { Bound, Constraints } from "./constraints";
import {
  assumeCondition,
  cloneConstraints,
  dedupeAbstractValues,
  evaluateCondition,
  forgetBinding,
  getConstraintsKey,
  getLengthAtom,
  resolveLiteral,
} from "./constraints";
import type {
  AbstractValue,
  Binding,
  ComponentAnalysis,
  ConditionalValue,
  JsxContainerValue,
  BindingPlace,
  Domain,
  Transition,
  State,
  Region,
  StateReport,
  SymbolicValue,
  Handler,
  StateUpdate,
} from "./types";
import { forEachJsxElement } from "./utils/for-each-jsx-element";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { mapSymbolicValue } from "./utils/map-symbolic-value";
import { formatNegated, formatSymbolicValue } from "./format";
import { appendToGroup } from "./utils/append-to-group";
import { getValueKey } from "./utils/get-value-key";
import { PlaceMap } from "./utils/place-map";
import { getBindingPlace } from "./utils/get-binding-place";
import { getValuePlace } from "./utils/get-value-place";
import { isSamePlace } from "./utils/is-same-place";
import { getTestExpression } from "./utils/get-test-expression";
import { getTruthiness } from "./utils/get-truthiness";
import { isNullish } from "./utils/is-nullish";
import { isStateBinding } from "./utils/is-state-binding";
import { isWholeBinding } from "./utils/is-whole-binding";
import { getBindingUpdates, isEffectHandler } from "./collect-handlers";
import { findRegions } from "./regions";
import { getBranchKey } from "./control-flow";
import type { RegionBranches } from "./regions";
import { collectUnreachableBranches } from "./unreachable-branches";
import type { BranchOutcomes } from "./unreachable-branches";

const MAX_ALTERNATIVES = 256;
const MAX_UPDATE_SEQUENCES = 256;
const MAX_TARGET_ENUMERATIONS = 262_144;
const MAX_REACHABILITY_ROUNDS = 8;

interface Alternative {
  constraints: Constraints;
  render: SymbolicValue;
  fragments: SymbolicValue[];
  conditions: string[];
  branches: ReadonlySet<string>;
  distanceFromFirstRender: number;
}

interface FirstRenderOutcomes {
  constraints: Constraints;
  outcomesByBranchKey: Map<string, boolean | null>;
}

interface PartialChildren extends Omit<Alternative, "render"> {
  children: SymbolicValue[];
}

type FieldCases = AbstractValue[] | "unchanged" | null;

interface ReachabilityContext {
  analysis: ComponentAnalysis;
  reachableConstraints: Constraints;
  dependentsByBinding: Map<number, number[]>;
}

interface TransitionBudget {
  remainingTargetEnumerations: number;
  isExhausted: boolean;
}

interface TransitionContext extends ReachabilityContext {
  budget: TransitionBudget;
  targetEnumerator: StateEnumerator;
  stateIndicesByKey: Map<string, number[]>;
  targetIndicesByConstraints: Map<string, number[]>;
  updateSequencesByHandler: Map<string, StateUpdate[][]>;
  firstStateIndex: number;
}

interface EnumerationContext extends ReachabilityContext {
  branchOutcomes: BranchOutcomes;
  effectIds: Set<string>;
  firstRender: FirstRenderOutcomes;
}

interface EnumeratedRegion {
  states: State[];
  region: Region;
  isTruncated: boolean;
}

const NO_BRANCHES: ReadonlySet<string> = new Set();
const constraintsKeys = new WeakMap<Constraints, string>();

const getCachedConstraintsKey = (constraints: Constraints): string => {
  const cachedKey = constraintsKeys.get(constraints);
  if (cachedKey !== undefined) return cachedKey;
  const constraintsKey = getConstraintsKey(constraints);
  constraintsKeys.set(constraints, constraintsKey);
  return constraintsKey;
};

const createLeaf = (constraints: Constraints, render: SymbolicValue): Alternative => ({
  constraints,
  render,
  fragments: [],
  conditions: [],
  branches: NO_BRANCHES,
  distanceFromFirstRender: 0,
});

const getStateKey = (alternative: Alternative): string =>
  [...alternative.branches].sort().join("|");

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

const createFirstRenderConstraints = (
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

const getFirstRenderOutcome = (
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

const getUpdatePaths = (updates: StateUpdate[]): StateUpdate[][] => {
  if (updates.length === 0) return [[]];
  const guardKeysByPath = new Map(
    updates.map((update) => {
      const guardKeys = getGuardKeys(update);
      return [guardKeys.join("\0"), guardKeys];
    }),
  );
  return [...guardKeysByPath.values()].map((guardKeys) =>
    updates.filter((update) => isGuardPrefix(getGuardKeys(update), guardKeys)),
  );
};

const getUpdatesBeforeLaterAsyncUpdates = (updates: StateUpdate[]): StateUpdate[][] =>
  updates.flatMap((update, index) =>
    update.isAsync && index < updates.length - 1 ? [updates.slice(0, index + 1)] : [],
  );

const dedupeUpdateSequences = (handler: Handler, sequences: StateUpdate[][]): StateUpdate[][] => {
  const indexByUpdate = new Map(handler.updates.map((update, index) => [update, index]));
  return [
    ...new Map(
      sequences.map((sequence) => [
        sequence.map((update) => indexByUpdate.get(update)).join(","),
        sequence,
      ]),
    ).values(),
  ];
};

const getHandlerUpdateSequences = (handler: Handler, budget: TransitionBudget): StateUpdate[][] => {
  const synchronousUpdates = handler.updates.filter((update) => !update.isAsync);
  const mayChangeNothing = handler.updates.some((update) => update.guards.length > 0);
  const sequences = dedupeUpdateSequences(handler, [
    ...(mayChangeNothing ? [[]] : []),
    ...(synchronousUpdates.length < handler.updates.length
      ? getUpdatePaths(synchronousUpdates)
      : []),
    ...getUpdatesBeforeLaterAsyncUpdates(handler.updates).flatMap(getUpdatePaths),
    ...getUpdatePaths(handler.updates),
  ]);
  if (sequences.length <= MAX_UPDATE_SEQUENCES) return sequences;
  budget.isExhausted = true;
  return sequences.slice(0, MAX_UPDATE_SEQUENCES);
};

const getConstraintsAfterUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  context: ReachabilityContext,
): Constraints =>
  updates.length === 0
    ? constraints
    : applyUpdates(updates, constraints, context.reachableConstraints, context.dependentsByBinding);

const getCachedTargetIndices = (
  afterHandler: Constraints,
  context: TransitionContext,
): number[] => {
  const constraintsKey = getCachedConstraintsKey(afterHandler);
  const cachedIndices = context.targetIndicesByConstraints.get(constraintsKey);
  if (cachedIndices) return cachedIndices;
  const targetIndices = context.targetEnumerator
    .enumerate(context.analysis.render, afterHandler)
    .flatMap((alternative) => context.stateIndicesByKey.get(getStateKey(alternative)) ?? []);
  context.targetIndicesByConstraints.set(constraintsKey, targetIndices);
  return targetIndices;
};

const getCachedUpdateSequences = (
  handler: Handler,
  context: TransitionContext,
): StateUpdate[][] => {
  const cachedSequences = context.updateSequencesByHandler.get(handler.id);
  if (cachedSequences) return cachedSequences;
  const sequences = getHandlerUpdateSequences(handler, context.budget);
  context.updateSequencesByHandler.set(handler.id, sequences);
  return sequences;
};

const getTargetStateIndices = (
  handler: Handler,
  constraints: Constraints,
  context: TransitionContext,
): Set<number> => {
  const targetIndices = new Set<number>();
  for (const updates of getCachedUpdateSequences(handler, context)) {
    if (context.budget.remainingTargetEnumerations <= 0) {
      context.budget.isExhausted = true;
      break;
    }
    context.budget.remainingTargetEnumerations--;
    const afterHandler = getConstraintsAfterUpdates(updates, constraints, context);
    for (const index of getCachedTargetIndices(afterHandler, context)) targetIndices.add(index);
  }
  return targetIndices;
};

class StateEnumerator {
  readonly #branchOutcomes: BranchOutcomes;
  readonly #region: RegionBranches;
  readonly #firstRender: FirstRenderOutcomes;
  readonly #shouldDescribeStates: boolean;
  readonly #alternativesCache = new WeakMap<SymbolicValue, WeakMap<Constraints, Alternative[]>>();
  #isTruncated = false;

  constructor(
    branchOutcomes: BranchOutcomes,
    region: RegionBranches,
    firstRender: FirstRenderOutcomes,
    shouldDescribeStates: boolean,
  ) {
    this.#branchOutcomes = branchOutcomes;
    this.#region = region;
    this.#firstRender = firstRender;
    this.#shouldDescribeStates = shouldDescribeStates;
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

  #keepNearestFirstRender(alternatives: Alternative[]): Alternative[] {
    if (alternatives.length <= MAX_ALTERNATIVES) return alternatives;
    this.#isTruncated = true;
    return [...alternatives]
      .sort((left, right) => left.distanceFromFirstRender - right.distanceFromFirstRender)
      .slice(0, MAX_ALTERNATIVES);
  }

  #recordOutcome(branchKey: string, isTrue: boolean): void {
    this.#branchOutcomes.set(
      branchKey,
      new Set([...(this.#branchOutcomes.get(branchKey) ?? []), isTrue]),
    );
  }

  #enumerateBranch(conditional: ConditionalValue, constraints: Constraints): Alternative[] {
    const branchKey = getBranchKey(conditional.branch);
    if (!this.#region.branchKeys.has(branchKey)) return [createLeaf(constraints, conditional)];
    const test = getTestExpression(conditional);
    const firstRenderOutcome = getFirstRenderOutcome(this.#firstRender, branchKey, test);
    const alternatives: Alternative[] = [];
    let feasibleArmCount = 0;
    for (const isTrue of [true, false]) {
      const withOutcome = assumeCondition(test, isTrue, constraints);
      if (!withOutcome) continue;
      this.#recordOutcome(branchKey, isTrue);
      const isFirstRenderArm =
        firstRenderOutcome === null ? feasibleArmCount === 0 : isTrue === firstRenderOutcome;
      feasibleArmCount++;
      const conditionLabel = this.#getConditionLabel(test, isTrue, constraints);
      const arm = isTrue ? conditional.consequent : conditional.alternate;
      for (const alternative of this.enumerate(arm, withOutcome))
        alternatives.push({
          ...alternative,
          fragments: this.#shouldDescribeStates ? [alternative.render] : [],
          conditions:
            conditionLabel === null
              ? alternative.conditions
              : [conditionLabel, ...alternative.conditions],
          branches: new Set([...alternative.branches, `${branchKey}:${isTrue}`]),
          distanceFromFirstRender: alternative.distanceFromFirstRender + (isFirstRenderArm ? 0 : 1),
        });
    }
    return this.#keepNearestFirstRender(alternatives);
  }

  #getConditionLabel(
    test: SymbolicValue,
    isTrue: boolean,
    constraints: Constraints,
  ): string | null {
    if (!this.#shouldDescribeStates || evaluateCondition(test, constraints) !== null) return null;
    const simplifiedTest = simplifyDecidedConditionals(test, constraints);
    return isTrue ? formatSymbolicValue(simplifiedTest) : formatNegated(simplifiedTest);
  }

  #enumerateChildren(element: JsxContainerValue, constraints: Constraints): Alternative[] {
    const emptyPartial: PartialChildren = {
      constraints,
      children: [],
      fragments: [],
      conditions: [],
      branches: NO_BRANCHES,
      distanceFromFirstRender: 0,
    };
    const partials =
      this.#combineChildrenInOrder(element.children, emptyPartial) ??
      this.#combineChildrenNearestFirstRender(element.children, emptyPartial);
    return partials.map((partial) => ({
      constraints: partial.constraints,
      render: this.#shouldDescribeStates ? { ...element, children: partial.children } : element,
      fragments: partial.fragments,
      conditions: partial.conditions,
      branches: partial.branches,
      distanceFromFirstRender: partial.distanceFromFirstRender,
    }));
  }

  #extendPartial(partial: PartialChildren, childAlternative: Alternative): PartialChildren {
    return {
      constraints: childAlternative.constraints,
      children: this.#shouldDescribeStates
        ? [...partial.children, childAlternative.render]
        : partial.children,
      fragments: [...partial.fragments, ...childAlternative.fragments],
      conditions: [...partial.conditions, ...childAlternative.conditions],
      branches: new Set([...partial.branches, ...childAlternative.branches]),
      distanceFromFirstRender:
        partial.distanceFromFirstRender + childAlternative.distanceFromFirstRender,
    };
  }

  #combineChildrenInOrder(
    children: SymbolicValue[],
    emptyPartial: PartialChildren,
  ): PartialChildren[] | null {
    let partials = [emptyPartial];
    for (const child of children) {
      const nextPartials: PartialChildren[] = [];
      for (const partial of partials)
        for (const childAlternative of this.enumerate(child, partial.constraints)) {
          if (nextPartials.length >= MAX_ALTERNATIVES) {
            this.#isTruncated = true;
            return null;
          }
          nextPartials.push(this.#extendPartial(partial, childAlternative));
        }
      partials = nextPartials;
    }
    return partials;
  }

  #combineChildrenNearestFirstRender(
    children: SymbolicValue[],
    emptyPartial: PartialChildren,
  ): PartialChildren[] {
    const selected: PartialChildren[] = [];
    for (let distance = 0; selected.length < MAX_ALTERNATIVES; distance++) {
      const hasFartherCombinations = this.#collectAtDistance(
        children,
        0,
        emptyPartial,
        distance,
        selected,
      );
      if (!hasFartherCombinations) break;
    }
    return selected;
  }

  #collectAtDistance(
    children: SymbolicValue[],
    childIndex: number,
    partial: PartialChildren,
    remainingDistance: number,
    selected: PartialChildren[],
  ): boolean {
    const child = children[childIndex];
    if (!child) {
      if (remainingDistance === 0) selected.push(partial);
      return false;
    }
    let hasFartherCombinations = false;
    for (const childAlternative of this.enumerate(child, partial.constraints)) {
      if (selected.length >= MAX_ALTERNATIVES) break;
      if (childAlternative.distanceFromFirstRender > remainingDistance) {
        hasFartherCombinations = true;
        continue;
      }
      const isFarther = this.#collectAtDistance(
        children,
        childIndex + 1,
        this.#extendPartial(partial, childAlternative),
        remainingDistance - childAlternative.distanceFromFirstRender,
        selected,
      );
      hasFartherCombinations ||= isFarther;
    }
    return hasFartherCombinations;
  }
}

const collectHandlerIds = (render: SymbolicValue): Set<string> => {
  const handlerIds = new Set<string>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) if (prop.handlerId) handlerIds.add(prop.handlerId);
  });
  return handlerIds;
};

const getRegionHandlers = (analysis: ComponentAnalysis, region: RegionBranches): Handler[] =>
  region.hasUnknownTest
    ? analysis.handlers
    : analysis.handlers.filter((handler) =>
        handler.updates.some((update) => region.bindingIds.has(update.binding.id)),
      );

const getTransition = (
  handler: Handler,
  alternative: Alternative,
  context: TransitionContext,
): Transition => {
  const targetIndices = getTargetStateIndices(handler, alternative.constraints, context);
  return {
    handlerId: handler.id,
    targets: [...targetIndices]
      .sort((left, right) => left - right)
      .map((regionStateIndex) => context.firstStateIndex + regionStateIndex),
    isAsync: handler.updates.some((update) => update.isAsync),
  };
};

const getStateIndicesByKey = (alternatives: Alternative[]): Map<string, number[]> => {
  const stateIndicesByKey = new Map<string, number[]>();
  alternatives.forEach((alternative, regionStateIndex) =>
    appendToGroup(stateIndicesByKey, getStateKey(alternative), regionStateIndex),
  );
  return stateIndicesByKey;
};

const createRegion = (
  regionBranches: RegionBranches,
  firstStateIndex: number,
  stateCount: number,
): Region => ({
  placeNames: regionBranches.placeNames,
  bindingIds: [...regionBranches.bindingIds],
  states: Array.from(
    { length: stateCount },
    (_state, regionStateIndex) => firstStateIndex + regionStateIndex,
  ),
});

const withDecidedOutcomes = (
  branchOutcomes: BranchOutcomes,
  decidedBranchOutcomes: Map<string, boolean[]>,
): BranchOutcomes =>
  new Map(
    [...branchOutcomes].map(([branchKey, outcomes]) => [
      branchKey,
      new Set([...outcomes, ...(decidedBranchOutcomes.get(branchKey) ?? [])]),
    ]),
  );

const createTransitionContext = (
  regionBranches: RegionBranches,
  alternatives: Alternative[],
  firstStateIndex: number,
  context: EnumerationContext,
): TransitionContext => ({
  analysis: context.analysis,
  reachableConstraints: context.reachableConstraints,
  dependentsByBinding: context.dependentsByBinding,
  targetEnumerator: new StateEnumerator(new Map(), regionBranches, context.firstRender, false),
  stateIndicesByKey: getStateIndicesByKey(alternatives),
  targetIndicesByConstraints: new Map(),
  updateSequencesByHandler: new Map(),
  firstStateIndex,
  budget: { remainingTargetEnumerations: MAX_TARGET_ENUMERATIONS, isExhausted: false },
});

const createRegionEnumerator = (
  regionBranches: RegionBranches,
  context: EnumerationContext,
): StateEnumerator =>
  new StateEnumerator(context.branchOutcomes, regionBranches, context.firstRender, true);

const enumerateRegion = (
  regionBranches: RegionBranches,
  regionIndex: number,
  firstStateIndex: number,
  context: EnumerationContext,
): EnumeratedRegion => {
  const { analysis, effectIds } = context;
  const enumerator = createRegionEnumerator(regionBranches, context);
  const alternatives = enumerator.enumerate(analysis.render, context.reachableConstraints);
  const transitionContext = createTransitionContext(
    regionBranches,
    alternatives,
    firstStateIndex,
    context,
  );
  const regionHandlers = getRegionHandlers(analysis, regionBranches);
  const getTransitions = (alternative: Alternative): Transition[] => {
    const renderedHandlerIds = new Set([...effectIds, ...collectHandlerIds(alternative.render)]);
    return regionHandlers
      .filter((handler) => renderedHandlerIds.has(handler.id))
      .map((handler) => getTransition(handler, alternative, transitionContext));
  };
  return {
    states: alternatives.map((alternative) => ({
      regionIndex,
      conditions: alternative.conditions,
      render: alternative.render,
      fragments: alternative.fragments,
      transitions: getTransitions(alternative),
    })),
    region: createRegion(regionBranches, firstStateIndex, alternatives.length),
    isTruncated:
      enumerator.isTruncated ||
      transitionContext.targetEnumerator.isTruncated ||
      transitionContext.budget.isExhausted,
  };
};

export const enumerateStates = (analysis: ComponentAnalysis): StateReport => {
  const reachableConstraints = createInitialConstraints(analysis);
  const context: EnumerationContext = {
    analysis,
    reachableConstraints,
    dependentsByBinding: getDependentsByBinding(analysis.bindings),
    branchOutcomes: new Map(),
    effectIds: new Set(analysis.handlers.filter(isEffectHandler).map((handler) => handler.id)),
    firstRender: {
      constraints: createFirstRenderConstraints(analysis, reachableConstraints),
      outcomesByBranchKey: new Map(),
    },
  };
  const states: State[] = [];
  const regions: Region[] = [];
  let isTruncated = false;
  findRegions(analysis.render, analysis.bindings).forEach((regionBranches, regionIndex) => {
    const enumerated = enumerateRegion(regionBranches, regionIndex, states.length, context);
    states.push(...enumerated.states);
    regions.push(enumerated.region);
    isTruncated ||= enumerated.isTruncated;
  });
  return {
    places: reachableConstraints.possibleValues.clone(),
    states,
    regions,
    unreachableBranches: isTruncated
      ? []
      : collectUnreachableBranches(
          analysis.render,
          withDecidedOutcomes(context.branchOutcomes, analysis.decidedBranchOutcomes),
        ),
    isTruncated,
  };
};
