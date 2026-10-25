import {
  addBounds,
  assumeBranchOutcome,
  assumeCondition,
  assumeGuards,
  cloneConstraints,
  dedupeAbstractValues,
  evaluateCondition,
  forgetBinding,
  forgetUnknownAssumptions,
  getRelevantConstraintsKey,
} from "./constraints";
import type { Constraints } from "./constraints";
import { getFieldCases } from "./field-cases";
import type { RegionBranches } from "./regions";
import { getBranchKey } from "./control-flow";
import type {
  Binding,
  BindingPlace,
  ConditionalValue,
  Handler,
  StateUpdate,
  SymbolicValue,
  Transition,
} from "./types";
import { getTestExpression } from "./utils/get-test-expression";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getBindingPlace } from "./utils/get-binding-place";
import { getValueKey } from "./utils/get-value-key";
import type { EnumerationContext } from "./enumerate-states";
import type { ReachabilityContext } from "./reachable-constraints";
import { getToggleCases, getUpdateBounds, isLengthPreserving } from "./reachable-constraints";
import type { Alternative } from "./state-enumerator";

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
  relevantKeys: WeakMap<Constraints, string>;
  replayedOutcomes: WeakMap<Constraints, Map<ConditionalValue, Map<boolean, Constraints | null>>>;
  firstStateIndex: number;
}

const NO_MAYBE_UPDATES: ReadonlySet<StateUpdate> = new Set();

const applyUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  { reachableConstraints, reachablePlacesByBinding, dependentsByBinding }: ReachabilityContext,
  maybeUpdates = NO_MAYBE_UPDATES,
): Constraints => {
  const updated = cloneConstraints(constraints);
  const placesByBinding = groupPlacesByBinding(constraints.possibleValues.places());
  const updatedBindingIds = new Set<number>();
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
    forgetBinding(updated, update.binding.id, keepsRenderedLength);
    updatedBindingIds.add(update.binding.id);
    if (!isMaybe) addBounds(updated, getUpdateBounds(update.value, update.binding));
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
    const isUntracked = !isMaybe && !reachablePlacesByBinding.has(update.binding.id);
    const literalCases = isUntracked
      ? getFieldCases(update.value, [], update.binding, constraints)
      : null;
    if (Array.isArray(literalCases) && literalCases.every((value) => value.kind === "Literal")) {
      const bindingPlace = getBindingPlace(update.binding);
      updated.possibleValues.set(bindingPlace, dedupeAbstractValues(literalCases));
      addPlace(placesByBinding, bindingPlace);
    }
  }
  if (updates.length > 0) forgetUnknownAssumptions(updated);
  return updated;
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

const getOpenChoice = (
  update: StateUpdate,
  constraints: Constraints,
  outcomes: Map<string, boolean>,
): GuardChoice | "applied" | "skipped" => {
  let openChoice: GuardChoice | null = null;
  for (const choice of getGuardChoices(update)) {
    const outcome = outcomes.get(choice.key) ?? evaluateCondition(choice.test, constraints);
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
): GuardedSequence[] => {
  const sequences: GuardedSequence[] = [];
  const included: StateUpdate[] = [];
  const visit = (start: number, current: Constraints, outcomes: Map<string, boolean>): void => {
    const includedLength = included.length;
    for (const [index, update] of updates.entries()) {
      if (index < start) continue;
      const openChoice = getOpenChoice(update, current, outcomes);
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
    : [getWidenedSequence(updates, constraints)];
};

const getWidenedSequence = (updates: StateUpdate[], constraints: Constraints): GuardedSequence => {
  const included: StateUpdate[] = [];
  const maybeUpdates = new Set<StateUpdate>();
  const maybeValueKeys = new Map<number, Set<string>>();
  const firstAsyncIndex = updates.findIndex((update) => update.isAsync);
  for (const [index, update] of updates.entries()) {
    const outcomes = getGuardChoices(update).map((choice) => {
      const outcome = evaluateCondition(choice.test, constraints);
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
  return [true, false].flatMap((outcome) => {
    const branch = `${branchKey}:${outcome}`;
    if (!branches.has(branch)) return [];
    const assumed = paths.flatMap(({ constraints, visited }): ReplayedPath[] => {
      const next = assumeReplayedOutcome(value, outcome, constraints, context);
      return next ? [{ constraints: next, visited: new Set([...visited, branch]) }] : [];
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
    getRelevantConstraintsKey(afterHandler, context.relevantBindingIds);
  context.relevantKeys.set(afterHandler, constraintsKey);
  const cache = isReplayed
    ? context.targetIndicesByConstraints
    : context.candidateIndicesByConstraints;
  const cachedIndices = cache.get(constraintsKey);
  if (cachedIndices) return cachedIndices;
  const candidates = getCandidateIndices(afterHandler, context);
  const targetIndices = isReplayed
    ? candidates.filter((index) => {
        const target = context.stateBranches[index];
        return target !== undefined && isReplayedTarget(afterHandler, target, context);
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
        ? getGuardedSequences(updates, constraints)
        : [getWidenedSequence(updates, constraints)];
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

const collectBranchTests = (
  render: SymbolicValue,
  regionBranches: RegionBranches,
): Map<string, SymbolicValue | null> => {
  const branchTests = new Map<string, SymbolicValue | null>();
  const visited = new WeakSet<SymbolicValue>();
  const visit = (value: SymbolicValue): void => {
    if (visited.has(value)) return;
    visited.add(value);
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment") {
      value.children.forEach(visit);
      return;
    }
    if (value.kind !== "Conditional") return;
    const branchKey = getBranchKey(value.branch);
    if (!regionBranches.branchKeys.has(branchKey)) return;
    branchTests.set(branchKey, branchTests.has(branchKey) ? null : getTestExpression(value));
    visit(value.consequent);
    visit(value.alternate);
  };
  visit(render);
  return branchTests;
};

const getStateBranches = (alternative: Alternative): StateBranches => {
  const outcomes = new Map<string, boolean | null>();
  for (const branch of alternative.branches) {
    const separator = branch.lastIndexOf(":");
    const branchKey = branch.slice(0, separator);
    const outcome = branch.slice(separator + 1) === "true";
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
  bindings: Binding[],
): Set<number> => {
  const bindingIds = new Set(regionBranches.bindingIds);
  const addReadBindings = (value: SymbolicValue | null): void => {
    if (value)
      forEachSymbolicValue(value, (part) => {
        if (part.kind === "Binding") bindingIds.add(part.binding.id);
      });
  };
  const visited = new WeakSet<SymbolicValue>();
  const visit = (value: SymbolicValue): void => {
    if (visited.has(value)) return;
    visited.add(value);
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment") {
      value.children.forEach(visit);
      return;
    }
    if (value.kind !== "Conditional") return;
    if (regionBranches.branchKeys.has(getBranchKey(value.branch)))
      addReadBindings(getTestExpression(value));
    visit(value.consequent);
    visit(value.alternate);
  };
  visit(render);
  const bindingsById = new Map(bindings.map((binding) => [binding.id, binding]));
  for (const bindingId of bindingIds) {
    const binding = bindingsById.get(bindingId);
    if (!binding) continue;
    for (const place of binding.inputPlaces) bindingIds.add(place.bindingId);
    if (binding.lengthLimit) bindingIds.add(binding.lengthLimit.arrayLength.bindingId);
    addReadBindings(binding.alias);
    addReadBindings(binding.range?.inner ?? null);
    if (binding.derived && "operands" in binding.derived)
      binding.derived.operands.forEach(addReadBindings);
    if (binding.derived && "receiver" in binding.derived) addReadBindings(binding.derived.receiver);
  }
  return bindingIds;
};

export const createTransitionContext = (
  regionBranches: RegionBranches,
  alternatives: Alternative[],
  firstStateIndex: number,
  context: EnumerationContext,
): TransitionContext => ({
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
    context.analysis.bindings,
  ),
  relevantKeys: new WeakMap(),
  replayedOutcomes: new WeakMap(),
  firstStateIndex,
  budget: { remainingTargetEnumerations: MAX_TARGET_ENUMERATIONS },
});
