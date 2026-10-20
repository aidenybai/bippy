import { assumeGuards } from "./claim-guards";
import {
  cloneConstraints,
  dedupeAbstractValues,
  evaluateCondition,
  forgetBinding,
  forgetUnknownAssumptions,
} from "./constraints";
import type { Constraints } from "./constraints";
import { getFieldCases } from "./field-cases";
import type { RegionBranches } from "./regions";
import type { Handler, StateUpdate, SymbolicValue, Transition } from "./types";
import { appendToGroup } from "./utils/append-to-group";
import { getValueKey } from "./utils/get-value-key";
import type { EnumerationContext } from "./enumerate-states";
import type { ReachabilityContext } from "./reachable-constraints";
import { getLengthBounds, getToggleCases, isLengthPreserving } from "./reachable-constraints";
import type { Alternative } from "./state-enumerator";
import { StateEnumerator, getCachedConstraintsKey, getStateKey } from "./state-enumerator";

const MAX_UPDATE_SEQUENCES = 256;

const MAX_TARGET_ENUMERATIONS = 262_144;

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

const getSequenceGuards = (updates: StateUpdate[]): SymbolicValue[] =>
  updates.reduce<SymbolicValue[]>(
    (longest, update) => (update.guards.length > longest.length ? update.guards : longest),
    [],
  );

const isSurelyApplied = (update: StateUpdate, constraints: Constraints): boolean =>
  update.guards.every((guard) => evaluateCondition(guard, constraints) === true);

const getConstraintsBeforeUpdates = (
  handler: Handler,
  updates: StateUpdate[],
  constraints: Constraints,
): Constraints | null => {
  if (updates.length > 0) return assumeGuards(getSequenceGuards(updates), constraints);
  return handler.updates.some((update) => isSurelyApplied(update, constraints))
    ? null
    : constraints;
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
    for (const index of getCachedTargetIndices(afterHandler, context)) targetIndices.add(index);
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

const getStateIndicesByKey = (alternatives: Alternative[]): Map<string, number[]> => {
  const stateIndicesByKey = new Map<string, number[]>();
  alternatives.forEach((alternative, regionStateIndex) =>
    appendToGroup(stateIndicesByKey, getStateKey(alternative), regionStateIndex),
  );
  return stateIndicesByKey;
};

export const createTransitionContext = (
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
