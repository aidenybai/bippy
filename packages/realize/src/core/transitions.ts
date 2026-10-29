import { dedupeAbstractValues } from "./abstract-values";
import { addBounds } from "./bound-graph";
import {
  assumeBranchOutcome,
  assumeCondition,
  assumeGuards,
  cloneConstraints,
  evaluateCondition,
  forgetBinding,
  forgetUnknownAssumptions,
  getRelevantConstraintsKey,
  projectRelevantConstraints,
} from "./constraints";
import type { Constraints } from "./constraints";
import { getFieldCases } from "./field-cases";
import { getIntervalBounds } from "./reachable-ranges";
import type { RegionBranches } from "./regions";
import { getBranchKey } from "./control-flow";
import type {
  BindingPlace,
  ConditionalValue,
  Handler,
  StateUpdate,
  SymbolicValue,
  Transition,
} from "./types";
import { getTestExpression } from "./utils/get-test-expression";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { addReadBindings, createBindingInputsAdder } from "./utils/binding-inputs";
import { getBindingPlace } from "./utils/get-binding-place";
import { isSamePlace } from "./utils/is-same-place";
import { getValueKey } from "./utils/get-value-key";
import type { EnumerationContext } from "./enumeration-context";
import type { ReachabilityContext } from "./reachable-constraints";
import {
  getAppendedLengthBounds,
  getAssignedPaths,
  getShiftedBounds,
  getToggleCases,
  getUnchangedPaths,
  getUpdateBounds,
  isLengthPreserving,
} from "./reachable-constraints";
import type { Alternative } from "./state-enumerator";
import { getOutcomeKey, parseOutcomeKey } from "./branch-outcome";

const MAX_UPDATE_SEQUENCES = 256;

const MAX_TARGET_ENUMERATIONS = 262_144;

interface TransitionBudget {
  remainingTargetEnumerations: number;
}

interface StateBranches {
  branches: ReadonlySet<string>;
  outcomes: Map<string, boolean | null>;
}

interface TransitionContext extends ReachabilityContext {
  budget: TransitionBudget;
  regionBranches: RegionBranches;
  branchTests: Map<string, SymbolicValue | null>;
  stateBranches: StateBranches[];
  renderUpdates: StateUpdate[];
  targetIndicesByConstraints: Map<string, number[]>;
  candidateIndicesByConstraints: Map<string, number[]>;
  relevantBindingIds: ReadonlySet<number>;
  addBindingInputs: (bindingIds: Set<number>) => void;
  relevantKeys: WeakMap<Constraints, string>;
  replayedOutcomes: WeakMap<Constraints, Map<ConditionalValue, Map<boolean, Constraints | null>>>;
  guardOutcomes: WeakMap<Constraints, Map<string, boolean | null>>;
  firstStateIndex: number;
}

const NO_MAYBE_UPDATES: ReadonlySet<StateUpdate> = new Set();

const applyUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  {
    analysis,
    reachableConstraints,
    reachablePlacesByBinding,
    dependentsByBinding,
  }: ReachabilityContext,
  maybeUpdates = NO_MAYBE_UPDATES,
): Constraints => {
  const updated = cloneConstraints(constraints);
  const updatedBindingIds = new Set<number>();
  const sequenceBindingIds = new Set(
    updates.flatMap((update) => [
      update.binding.id,
      ...(dependentsByBinding.get(update.binding.id) ?? []),
    ]),
  );
  const placesByBinding = groupPlacesByBinding(
    constraints.possibleValues.placesOf(sequenceBindingIds),
  );
  for (const update of updates) {
    const isMaybe = maybeUpdates.has(update);
    for (const [place, reachableValues] of reachablePlacesByBinding.get(update.binding.id) ?? []) {
      const currentValues = constraints.possibleValues.get(place);
      const fieldCases =
        getFieldCases(update.value, place.path, update.binding, constraints) ??
        getToggleCases(update.value, place, currentValues);
      if (isMaybe) {
        const reachedValues = updated.possibleValues.get(place);
        const candidateValues = fieldCases === "unchanged" ? currentValues : fieldCases;
        if (reachedValues)
          updated.possibleValues.set(
            place,
            dedupeAbstractValues([...reachedValues, ...(candidateValues ?? reachableValues)]),
          );
        continue;
      }
      if (fieldCases === "unchanged") {
        if (currentValues) updated.possibleValues.set(place, currentValues);
        if (!currentValues) updated.possibleValues.delete(place);
        continue;
      }
      updated.possibleValues.set(
        place,
        fieldCases ? dedupeAbstractValues(fieldCases) : reachableValues,
      );
    }
    const keepsRenderedLength =
      !updatedBindingIds.has(update.binding.id) && isLengthPreserving(update.value, update.binding);
    const decidedValue = getDecidedValue(update.value, constraints);
    const shiftedBounds = update.isRepeated
      ? []
      : [
          ...getShiftedBounds(
            decidedValue,
            update.binding,
            [...constraints.bounds, ...constraints.invariants],
            sequenceBindingIds,
          ),
          ...getIntervalBounds(update, constraints, analysis.handlers),
          ...getAppendedLengthBounds(decidedValue, update.binding, constraints.bounds),
        ];
    forgetBinding(
      updated,
      update.binding.id,
      keepsRenderedLength,
      updatedBindingIds.has(update.binding.id)
        ? []
        : getUnchangedPaths(decidedValue, update.binding),
    );
    updatedBindingIds.add(update.binding.id);
    if (!isMaybe)
      addBounds(updated, [
        ...getUpdateBounds(decidedValue, update.binding, updated),
        ...shiftedBounds,
      ]);
    const dependentIds = new Set(dependentsByBinding.get(update.binding.id));
    for (const dependentId of dependentIds) {
      for (const [place, reachableValues] of reachablePlacesByBinding.get(dependentId) ?? [])
        updated.possibleValues.set(place, reachableValues);
      forgetBinding(updated, dependentId, false);
    }
    forgetUntrackedValues(
      updated,
      [update.binding.id, ...dependentIds],
      placesByBinding,
      reachableConstraints,
    );
    const reachablePlaces = reachablePlacesByBinding.get(update.binding.id);
    const untrackedPaths = isMaybe
      ? []
      : [
          ...(reachablePlaces ? [] : [[]]),
          ...getAssignedPaths(update.value).filter(
            (path) =>
              !reachablePlaces?.some(([place]) =>
                isSamePlace(place, getBindingPlace(update.binding, path)),
              ),
          ),
        ];
    for (const path of untrackedPaths) {
      const literalCases = getFieldCases(update.value, path, update.binding, constraints);
      if (!Array.isArray(literalCases) || literalCases.some((value) => value.kind !== "Literal"))
        continue;
      const bindingPlace = getBindingPlace(update.binding, path);
      updated.possibleValues.set(bindingPlace, dedupeAbstractValues(literalCases));
      addPlace(placesByBinding, bindingPlace);
    }
  }
  if (updates.length > 0) forgetUnknownAssumptions(updated);
  return updated;
};

const getDecidedValue = (value: SymbolicValue, constraints: Constraints): SymbolicValue => {
  if (value.kind !== "Conditional") return value;
  const outcome = evaluateCondition(getTestExpression(value), constraints);
  if (outcome === null) return value;
  return getDecidedValue(outcome ? value.consequent : value.alternate, constraints);
};

const addPlace = (placesByBinding: Map<number, BindingPlace[]>, place: BindingPlace): void => {
  const places = placesByBinding.get(place.bindingId) ?? [];
  places.push(place);
  placesByBinding.set(place.bindingId, places);
};

const groupPlacesByBinding = (places: BindingPlace[]): Map<number, BindingPlace[]> => {
  const placesByBinding = new Map<number, BindingPlace[]>();
  for (const place of places) addPlace(placesByBinding, place);
  return placesByBinding;
};

const forgetUntrackedValues = (
  constraints: Constraints,
  bindingIds: number[],
  placesByBinding: Map<number, BindingPlace[]>,
  reachableConstraints: Constraints,
): void => {
  for (const bindingId of new Set(bindingIds))
    for (const place of placesByBinding.get(bindingId) ?? [])
      if (!reachableConstraints.possibleValues.has(place)) constraints.possibleValues.delete(place);
};

interface GuardChoice {
  key: string;
  test: SymbolicValue;
  isTrue: boolean;
  readsBinding: boolean;
}

interface GuardedSequence {
  updates: StateUpdate[];
  constraints: Constraints;
  maybeUpdates: ReadonlySet<StateUpdate>;
}

const readsBinding = (value: SymbolicValue): boolean => {
  const bindingIds: number[] = [];
  forEachSymbolicValue(value, (part) => {
    if (part.kind === "Binding") bindingIds.push(part.binding.id);
  });
  return bindingIds.length > 0;
};

const getGuardChoice = (guard: SymbolicValue, isTrue = true): GuardChoice =>
  guard.kind === "UnaryExpression" && guard.operator === "!"
    ? getGuardChoice(guard.value, !isTrue)
    : { key: getValueKey(guard), test: guard, isTrue, readsBinding: readsBinding(guard) };

const getCandidateUpdateLists = (handler: Handler): StateUpdate[][] => {
  const synchronousUpdates = handler.updates.filter((update) => !update.isAsync);
  return synchronousUpdates.length < handler.updates.length
    ? [synchronousUpdates, handler.updates]
    : [handler.updates];
};

const guardChoicesByUpdate = new WeakMap<StateUpdate, GuardChoice[]>();

const getGuardChoices = (update: StateUpdate): GuardChoice[] => {
  const cached = guardChoicesByUpdate.get(update);
  if (cached) return cached;
  const choices = update.guards.map((guard) => getGuardChoice(guard));
  guardChoicesByUpdate.set(update, choices);
  return choices;
};

const evaluateGuard = (
  choice: GuardChoice,
  constraints: Constraints,
  context: TransitionContext,
): boolean | null => {
  const outcomes = context.guardOutcomes.get(constraints) ?? new Map<string, boolean | null>();
  context.guardOutcomes.set(constraints, outcomes);
  if (outcomes.has(choice.key)) return outcomes.get(choice.key) ?? null;
  const outcome = evaluateCondition(choice.test, constraints);
  outcomes.set(choice.key, outcome);
  return outcome;
};

const getOpenChoice = (
  update: StateUpdate,
  constraints: Constraints,
  outcomes: Map<string, boolean>,
  context: TransitionContext,
): GuardChoice | "applied" | "skipped" => {
  let openChoice: GuardChoice | null = null;
  for (const choice of getGuardChoices(update)) {
    const outcome = outcomes.get(choice.key) ?? evaluateGuard(choice, constraints, context);
    if (outcome === null) {
      openChoice ??= choice;
      continue;
    }
    outcomes.set(choice.key, outcome);
    if (outcome !== choice.isTrue) return "skipped";
  }
  return openChoice ?? "applied";
};

const getGuardedSequences = (
  updates: StateUpdate[],
  constraints: Constraints,
  context: TransitionContext,
): GuardedSequence[] => {
  const sequences: GuardedSequence[] = [];
  const included: StateUpdate[] = [];
  const visit = (start: number, current: Constraints, outcomes: Map<string, boolean>): void => {
    const includedLength = included.length;
    for (const [index, update] of updates.entries()) {
      if (index < start) continue;
      const openChoice = getOpenChoice(update, current, outcomes, context);
      if (typeof openChoice !== "string") {
        for (const outcome of [true, false]) {
          const assumed = openChoice.readsBinding
            ? assumeCondition(openChoice.test, outcome, current)
            : current;
          if (assumed && sequences.length <= MAX_UPDATE_SEQUENCES)
            visit(index, assumed, new Map(outcomes).set(openChoice.key, outcome));
        }
        included.length = includedLength;
        return;
      }
      if (openChoice === "applied") included.push(update);
      if (update.isAsync && index < updates.length - 1)
        sequences.push({
          updates: [...included],
          constraints: current,
          maybeUpdates: NO_MAYBE_UPDATES,
        });
    }
    sequences.push({
      updates: [...included],
      constraints: current,
      maybeUpdates: NO_MAYBE_UPDATES,
    });
    included.length = includedLength;
  };
  visit(0, constraints, new Map());
  return sequences.length <= MAX_UPDATE_SEQUENCES
    ? sequences
    : [getWidenedSequence(updates, constraints, context)];
};

const getWidenedSequence = (
  updates: StateUpdate[],
  constraints: Constraints,
  context: TransitionContext,
): GuardedSequence => {
  const included: StateUpdate[] = [];
  const maybeUpdates = new Set<StateUpdate>();
  const maybeValueKeys = new Map<number, Set<string>>();
  const firstAsyncIndex = updates.findIndex((update) => update.isAsync);
  for (const [index, update] of updates.entries()) {
    const outcomes = getGuardChoices(update).map((choice) => {
      const outcome = evaluateGuard(choice, constraints, context);
      return outcome === null ? null : outcome === choice.isTrue;
    });
    if (outcomes.includes(false)) continue;
    const isAfterAwait = firstAsyncIndex !== -1 && index >= firstAsyncIndex;
    const isMaybe = isAfterAwait || outcomes.includes(null);
    const valueKeys = maybeValueKeys.get(update.binding.id) ?? new Set();
    const valueKey = getValueKey(update.value);
    if (isMaybe && valueKeys.has(valueKey)) continue;
    if (isMaybe) maybeUpdates.add(update);
    maybeValueKeys.set(update.binding.id, isMaybe ? valueKeys.add(valueKey) : new Set());
    included.push(update);
  }
  return { updates: included, constraints, maybeUpdates };
};

const getConstraintsAfterUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  context: ReachabilityContext,
  maybeUpdates = NO_MAYBE_UPDATES,
): Constraints =>
  updates.length === 0 ? constraints : applyUpdates(updates, constraints, context, maybeUpdates);

export const settleRenderUpdates = (
  constraints: Constraints,
  renderUpdates: StateUpdate[],
  context: ReachabilityContext,
): Constraints[] =>
  renderUpdates.reduce<Constraints[]>(
    (settled, update) =>
      settled.flatMap((current) => {
        if (update.guards.length === 0) return [current];
        const outcomes = update.guards.map((guard) => evaluateCondition(guard, current));
        if (outcomes.some((outcome) => outcome === false)) return [current];
        const isCertain = outcomes.every((outcome) => outcome === true);
        const assumed = isCertain ? current : assumeGuards(update.guards, current);
        const applied = assumed && getConstraintsAfterUpdates([update], assumed, context);
        return isCertain ? (applied ? [applied] : []) : [current, ...(applied ? [applied] : [])];
      }),
    [constraints],
  );

interface ReplayedPath {
  constraints: Constraints;
  visited: Set<string>;
}

const assumeReplayedOutcome = (
  conditional: ConditionalValue,
  outcome: boolean,
  constraints: Constraints,
  context: TransitionContext,
): Constraints | null => {
  const byConditional = context.replayedOutcomes.get(constraints) ?? new Map();
  context.replayedOutcomes.set(constraints, byConditional);
  const outcomes = byConditional.get(conditional) ?? new Map<boolean, Constraints | null>();
  byConditional.set(conditional, outcomes);
  const cached = outcomes.get(outcome);
  if (cached !== undefined) return cached;
  const assumed = assumeBranchOutcome(getTestExpression(conditional), outcome, constraints);
  outcomes.set(outcome, assumed);
  return assumed;
};

const outcomeBranchesByKey = new Map<string, [string, string]>();

const getOutcomeBranches = (branchKey: string): [string, string] => {
  const cached = outcomeBranchesByKey.get(branchKey);
  if (cached) return cached;
  const outcomeBranches: [string, string] = [
    getOutcomeKey(branchKey, true),
    getOutcomeKey(branchKey, false),
  ];
  outcomeBranchesByKey.set(branchKey, outcomeBranches);
  return outcomeBranches;
};

const replayBranches = (
  value: SymbolicValue,
  branches: ReadonlySet<string>,
  paths: ReplayedPath[],
  context: TransitionContext,
): ReplayedPath[] => {
  if (paths.length === 0) return paths;
  if (value.kind === "JsxExpression" || value.kind === "JsxFragment")
    return value.children.reduce(
      (current, child) => replayBranches(child, branches, current, context),
      paths,
    );
  if (value.kind !== "Conditional") return paths;
  const branchKey = getBranchKey(value.branch);
  if (!context.regionBranches.branchKeys.has(branchKey)) return paths;
  const outcomeBranches = getOutcomeBranches(branchKey);
  return [true, false].flatMap((outcome) => {
    const branch = outcome ? outcomeBranches[0] : outcomeBranches[1];
    if (!branches.has(branch)) return [];
    const assumed = paths.flatMap(({ constraints, visited }): ReplayedPath[] => {
      const next = assumeReplayedOutcome(value, outcome, constraints, context);
      if (!next) return [];
      return [
        {
          constraints: next,
          visited: visited.has(branch) ? visited : new Set(visited).add(branch),
        },
      ];
    });
    return replayBranches(outcome ? value.consequent : value.alternate, branches, assumed, context);
  });
};

const getCandidateIndices = (afterHandler: Constraints, context: TransitionContext): number[] => {
  const decidedOutcomes = new Map<string, boolean>();
  for (const [branchKey, test] of context.branchTests) {
    const outcome = test && evaluateCondition(test, afterHandler);
    if (outcome !== null) decidedOutcomes.set(branchKey, outcome);
  }
  return context.stateBranches.flatMap((target, index) =>
    [...target.outcomes].some(([branchKey, outcome]) => {
      const decidedOutcome = decidedOutcomes.get(branchKey);
      return outcome !== null && decidedOutcome !== undefined && decidedOutcome !== outcome;
    })
      ? []
      : [index],
  );
};

const isReplayedTarget = (
  afterHandler: Constraints,
  target: StateBranches,
  context: TransitionContext,
): boolean =>
  replayBranches(
    context.analysis.render,
    target.branches,
    [{ constraints: afterHandler, visited: new Set() }],
    context,
  ).some(({ visited }) => visited.size === target.branches.size);

const getTargetIndices = (
  afterHandler: Constraints,
  isReplayed: boolean,
  context: TransitionContext,
): number[] => {
  const constraintsKey =
    context.relevantKeys.get(afterHandler) ??
    getRelevantConstraintsKey(afterHandler, context.relevantBindingIds, context.addBindingInputs);
  context.relevantKeys.set(afterHandler, constraintsKey);
  const cache = isReplayed
    ? context.targetIndicesByConstraints
    : context.candidateIndicesByConstraints;
  const cachedIndices = cache.get(constraintsKey);
  if (cachedIndices) return cachedIndices;
  const relevant = projectRelevantConstraints(
    afterHandler,
    context.relevantBindingIds,
    context.addBindingInputs,
  );
  const candidates = getCandidateIndices(relevant, context);
  const targetIndices = isReplayed
    ? candidates.filter((index) => {
        const target = context.stateBranches[index];
        return target !== undefined && isReplayedTarget(relevant, target, context);
      })
    : candidates;
  cache.set(constraintsKey, targetIndices);
  return targetIndices;
};

const getTargetStateIndices = (
  handler: Handler,
  constraints: Constraints,
  context: TransitionContext,
): Set<number> => {
  const targetIndices = new Set<number>();
  for (const updates of getCandidateUpdateLists(handler)) {
    const sequences =
      context.budget.remainingTargetEnumerations > 0
        ? getGuardedSequences(updates, constraints, context)
        : [getWidenedSequence(updates, constraints, context)];
    for (const sequence of sequences) {
      const isReplayed = context.budget.remainingTargetEnumerations > 0;
      context.budget.remainingTargetEnumerations--;
      const afterHandler = getConstraintsAfterUpdates(
        sequence.updates,
        sequence.constraints,
        context,
        sequence.maybeUpdates,
      );
      for (const settled of settleRenderUpdates(afterHandler, context.renderUpdates, context))
        for (const index of getTargetIndices(settled, isReplayed, context))
          targetIndices.add(index);
    }
  }
  return targetIndices;
};

export const getTransition = (
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

const forEachRenderedConditional = (
  render: SymbolicValue,
  visitConditional: (conditional: ConditionalValue) => boolean,
): void => {
  const visited = new WeakSet<SymbolicValue>();
  const visit = (value: SymbolicValue): void => {
    if (visited.has(value)) return;
    visited.add(value);
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment") {
      value.children.forEach(visit);
      return;
    }
    if (value.kind !== "Conditional" || !visitConditional(value)) return;
    visit(value.consequent);
    visit(value.alternate);
  };
  visit(render);
};

const collectBranchTests = (
  render: SymbolicValue,
  regionBranches: RegionBranches,
): Map<string, SymbolicValue | null> => {
  const branchTests = new Map<string, SymbolicValue | null>();
  forEachRenderedConditional(render, (conditional) => {
    const branchKey = getBranchKey(conditional.branch);
    if (!regionBranches.branchKeys.has(branchKey)) return false;
    branchTests.set(branchKey, branchTests.has(branchKey) ? null : getTestExpression(conditional));
    return true;
  });
  return branchTests;
};

const getStateBranches = (alternative: Alternative): StateBranches => {
  const outcomes = new Map<string, boolean | null>();
  for (const branch of alternative.branches) {
    const { branchKey, isTrue: outcome } = parseOutcomeKey(branch);
    outcomes.set(
      branchKey,
      outcomes.has(branchKey) && outcomes.get(branchKey) !== outcome ? null : outcome,
    );
  }
  return { branches: alternative.branches, outcomes };
};

const getBranchContext = (
  regionBranches: RegionBranches,
  alternatives: Alternative[],
  context: EnumerationContext,
): Pick<TransitionContext, "regionBranches" | "branchTests" | "stateBranches"> => ({
  regionBranches,
  branchTests: collectBranchTests(context.analysis.render, regionBranches),
  stateBranches: alternatives.map(getStateBranches),
});

const getRelevantBindingIds = (
  render: SymbolicValue,
  regionBranches: RegionBranches,
  addBindingInputs: (bindingIds: Set<number>) => void,
): Set<number> => {
  const bindingIds = new Set(regionBranches.bindingIds);
  forEachRenderedConditional(render, (conditional) => {
    if (regionBranches.branchKeys.has(getBranchKey(conditional.branch)))
      addReadBindings(bindingIds, getTestExpression(conditional));
    return true;
  });
  addBindingInputs(bindingIds);
  return bindingIds;
};

export const createTransitionContext = (
  regionBranches: RegionBranches,
  alternatives: Alternative[],
  firstStateIndex: number,
  context: EnumerationContext,
): TransitionContext => {
  const addBindingInputs = createBindingInputsAdder(context.analysis.bindings);
  return {
    analysis: context.analysis,
    reachableConstraints: context.reachableConstraints,
    reachablePlacesByBinding: context.reachablePlacesByBinding,
    dependentsByBinding: context.dependentsByBinding,
    ...getBranchContext(regionBranches, alternatives, context),
    renderUpdates: context.renderUpdates,
    targetIndicesByConstraints: new Map(),
    candidateIndicesByConstraints: new Map(),
    relevantBindingIds: getRelevantBindingIds(
      context.analysis.render,
      regionBranches,
      addBindingInputs,
    ),
    addBindingInputs,
    relevantKeys: new WeakMap(),
    replayedOutcomes: new WeakMap(),
    guardOutcomes: new WeakMap(),
    firstStateIndex,
    budget: { remainingTargetEnumerations: MAX_TARGET_ENUMERATIONS },
  };
};
