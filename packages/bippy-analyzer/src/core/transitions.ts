import { assumeGuards } from "./claim-guards";
import {
  addBounds,
  assumeCondition,
  cloneConstraints,
  dedupeAbstractValues,
  evaluateCondition,
  forgetBinding,
  forgetUnknownAssumptions,
} from "./constraints";
import type { Constraints } from "./constraints";
import { getFieldCases } from "./field-cases";
import type { RegionBranches } from "./regions";
import { getBranchKey } from "./control-flow";
import type { Handler, StateUpdate, SymbolicValue, Transition } from "./types";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";
import type { EnumerationContext } from "./enumerate-states";
import type { ReachabilityContext } from "./reachable-constraints";
import { getLengthBounds, getToggleCases, isLengthPreserving } from "./reachable-constraints";
import type { Alternative } from "./state-enumerator";
import { getCachedConstraintsKey } from "./state-enumerator";

const MAX_UPDATE_SEQUENCES = 256;

const MAX_TARGET_ENUMERATIONS = 262_144;

interface TransitionBudget {
  remainingTargetEnumerations: number;
  isExhausted: boolean;
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
  targetIndicesByConstraints: Map<string, number[]>;
  updateSequencesByHandler: Map<string, StateUpdate[][]>;
  firstStateIndex: number;
}

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
    forgetBinding(updated, update.binding.id, isLengthPreserving(update.value, update.binding));
    addBounds(updated, getLengthBounds(update.value, update.binding));
    const dependentIds = new Set(dependentsByBinding.get(update.binding.id));
    for (const [place, reachableValues] of reachableConstraints.possibleValues)
      if (dependentIds.has(place.bindingId)) updated.possibleValues.set(place, reachableValues);
    for (const dependentId of dependentIds) forgetBinding(updated, dependentId, false);
    forgetUntrackedValues(
      updated,
      new Set([update.binding.id, ...dependentIds]),
      reachableConstraints,
    );
  }
  if (updates.length > 0) forgetUnknownAssumptions(updated);
  return updated;
};

const forgetUntrackedValues = (
  constraints: Constraints,
  bindingIds: Set<number>,
  reachableConstraints: Constraints,
): void => {
  for (const place of constraints.possibleValues.places())
    if (bindingIds.has(place.bindingId) && !reachableConstraints.possibleValues.has(place))
      constraints.possibleValues.delete(place);
};

const isGuardPrefix = (prefix: string[], guardKeys: string[]): boolean =>
  prefix.every((guardKey, index) => guardKeys[index] === guardKey);

const getHandlerUpdateSequences = (handler: Handler, budget: TransitionBudget): StateUpdate[][] => {
  const guardKeysByUpdate = new Map(
    handler.updates.map((update) => [update, update.guards.map(getValueKey)]),
  );
  const indexByUpdate = new Map(handler.updates.map((update, index) => [update, index]));
  const sequencesByKey = new Map<string, StateUpdate[]>();
  const isFull = (): boolean => sequencesByKey.size > MAX_UPDATE_SEQUENCES;
  const addSequence = (sequence: StateUpdate[]): void => {
    sequencesByKey.set(sequence.map((update) => indexByUpdate.get(update)).join(","), sequence);
  };
  const addPaths = (updates: StateUpdate[]): void => {
    if (updates.length === 0) addSequence([]);
    const pathKeys = new Set<string>();
    for (const pathUpdate of updates) {
      if (isFull()) return;
      const guardKeys = guardKeysByUpdate.get(pathUpdate) ?? [];
      const pathKey = guardKeys.join("\0");
      if (pathKeys.has(pathKey)) continue;
      pathKeys.add(pathKey);
      addSequence(
        updates.filter((update) => isGuardPrefix(guardKeysByUpdate.get(update) ?? [], guardKeys)),
      );
    }
  };
  const synchronousUpdates = handler.updates.filter((update) => !update.isAsync);
  if (handler.updates.some((update) => update.guards.length > 0)) addSequence([]);
  if (synchronousUpdates.length < handler.updates.length) addPaths(synchronousUpdates);
  handler.updates.forEach((update, index) => {
    if (!isFull() && update.isAsync && index < handler.updates.length - 1)
      addPaths(handler.updates.slice(0, index + 1));
  });
  addPaths(handler.updates);
  const sequences = [...sequencesByKey.values()];
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

interface ReplayedPath {
  constraints: Constraints;
  visited: Set<string>;
}

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
  const test = getTestExpression(value);
  return [true, false].flatMap((outcome) => {
    const branch = `${branchKey}:${outcome}`;
    if (!branches.has(branch)) return [];
    const assumed = paths.flatMap(({ constraints, visited }): ReplayedPath[] => {
      const next = assumeCondition(test, outcome, constraints);
      return next ? [{ constraints: next, visited: new Set([...visited, branch]) }] : [];
    });
    return replayBranches(outcome ? value.consequent : value.alternate, branches, assumed, context);
  });
};

const getTargetIndices = (afterHandler: Constraints, context: TransitionContext): number[] => {
  const constraintsKey = getCachedConstraintsKey(afterHandler);
  const cachedIndices = context.targetIndicesByConstraints.get(constraintsKey);
  if (cachedIndices) return cachedIndices;
  const decidedOutcomes = new Map<string, boolean>();
  for (const [branchKey, test] of context.branchTests) {
    const outcome = test && evaluateCondition(test, afterHandler);
    if (outcome !== null) decidedOutcomes.set(branchKey, outcome);
  }
  const targetIndices = context.stateBranches.flatMap((target, index) => {
    const contradictsDecidedOutcome = [...target.outcomes].some(([branchKey, outcome]) => {
      const decidedOutcome = decidedOutcomes.get(branchKey);
      return outcome !== null && decidedOutcome !== undefined && decidedOutcome !== outcome;
    });
    if (contradictsDecidedOutcome) return [];
    const paths = replayBranches(
      context.analysis.render,
      target.branches,
      [{ constraints: afterHandler, visited: new Set() }],
      context,
    );
    return paths.some(({ visited }) => visited.size === target.branches.size) ? [index] : [];
  });
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

const getSequenceGuards = (updates: StateUpdate[]): SymbolicValue[] =>
  updates.reduce<SymbolicValue[]>(
    (longest, update) => (update.guards.length > longest.length ? update.guards : longest),
    [],
  );

const hasSurelyAppliedUpdate = (updates: StateUpdate[], constraints: Constraints): boolean => {
  const isTrueByKey = new Map<string, boolean>();
  const isSurelyTrue = (guard: SymbolicValue): boolean => {
    const key = getValueKey(guard);
    const cached = isTrueByKey.get(key);
    if (cached !== undefined) return cached;
    const isTrue = evaluateCondition(guard, constraints) === true;
    isTrueByKey.set(key, isTrue);
    return isTrue;
  };
  return updates.some((update) => update.guards.every(isSurelyTrue));
};

const getConstraintsBeforeUpdates = (
  handler: Handler,
  updates: StateUpdate[],
  constraints: Constraints,
): Constraints | null => {
  if (updates.length > 0) return assumeGuards(getSequenceGuards(updates), constraints);
  return hasSurelyAppliedUpdate(handler.updates, constraints) ? null : constraints;
};

const getTargetStateIndices = (
  handler: Handler,
  constraints: Constraints,
  context: TransitionContext,
): Set<number> => {
  const targetIndices = new Set<number>();
  for (const updates of getCachedUpdateSequences(handler, context)) {
    const beforeHandler = getConstraintsBeforeUpdates(handler, updates, constraints);
    if (!beforeHandler) continue;
    if (context.budget.remainingTargetEnumerations <= 0) {
      context.budget.isExhausted = true;
      break;
    }
    context.budget.remainingTargetEnumerations--;
    const afterHandler = getConstraintsAfterUpdates(updates, beforeHandler, context);
    for (const index of getTargetIndices(afterHandler, context)) targetIndices.add(index);
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

export const createTransitionContext = (
  regionBranches: RegionBranches,
  alternatives: Alternative[],
  firstStateIndex: number,
  context: EnumerationContext,
): TransitionContext => ({
  analysis: context.analysis,
  reachableConstraints: context.reachableConstraints,
  dependentsByBinding: context.dependentsByBinding,
  ...getBranchContext(regionBranches, alternatives, context),
  targetIndicesByConstraints: new Map(),
  updateSequencesByHandler: new Map(),
  firstStateIndex,
  budget: { remainingTargetEnumerations: MAX_TARGET_ENUMERATIONS, isExhausted: false },
});
