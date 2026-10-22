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
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getValueKey } from "./utils/get-value-key";
import type { EnumerationContext } from "./enumerate-states";
import type { ReachabilityContext } from "./reachable-constraints";
import { getToggleCases, getUpdateBounds, isLengthPreserving } from "./reachable-constraints";
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
  renderUpdates: StateUpdate[];
  targetIndicesByConstraints: Map<string, number[]>;
  firstStateIndex: number;
}

const applyUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  { reachableConstraints, reachablePlacesByBinding, dependentsByBinding }: ReachabilityContext,
): Constraints => {
  const updated = cloneConstraints(constraints);
  for (const update of updates) {
    for (const [place, reachableValues] of reachablePlacesByBinding.get(update.binding.id) ?? []) {
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
    addBounds(updated, getUpdateBounds(update.value, update.binding));
    const dependentIds = new Set(dependentsByBinding.get(update.binding.id));
    for (const dependentId of dependentIds) {
      for (const [place, reachableValues] of reachablePlacesByBinding.get(dependentId) ?? [])
        updated.possibleValues.set(place, reachableValues);
      forgetBinding(updated, dependentId, false);
    }
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

interface GuardChoice {
  key: string;
  test: SymbolicValue;
  isTrue: boolean;
  readsBinding: boolean;
}

interface GuardedSequence {
  updates: StateUpdate[];
  constraints: Constraints;
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
  budget: TransitionBudget,
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
        sequences.push({ updates: [...included], constraints: current });
    }
    sequences.push({ updates: [...included], constraints: current });
    included.length = includedLength;
  };
  visit(0, constraints, new Map());
  if (sequences.length <= MAX_UPDATE_SEQUENCES) return sequences;
  budget.isExhausted = true;
  return sequences.slice(0, MAX_UPDATE_SEQUENCES);
};

const getConstraintsAfterUpdates = (
  updates: StateUpdate[],
  constraints: Constraints,
  context: ReachabilityContext,
): Constraints =>
  updates.length === 0 ? constraints : applyUpdates(updates, constraints, context);

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

const getTargetStateIndices = (
  handler: Handler,
  constraints: Constraints,
  context: TransitionContext,
): Set<number> => {
  const targetIndices = new Set<number>();
  for (const updates of getCandidateUpdateLists(handler))
    for (const sequence of getGuardedSequences(updates, constraints, context.budget)) {
      if (context.budget.remainingTargetEnumerations <= 0) {
        context.budget.isExhausted = true;
        return targetIndices;
      }
      context.budget.remainingTargetEnumerations--;
      const afterHandler = getConstraintsAfterUpdates(
        sequence.updates,
        sequence.constraints,
        context,
      );
      for (const settled of settleRenderUpdates(afterHandler, context.renderUpdates, context))
        for (const index of getTargetIndices(settled, context)) targetIndices.add(index);
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
  reachablePlacesByBinding: context.reachablePlacesByBinding,
  dependentsByBinding: context.dependentsByBinding,
  ...getBranchContext(regionBranches, alternatives, context),
  renderUpdates: context.renderUpdates,
  targetIndicesByConstraints: new Map(),
  firstStateIndex,
  budget: { remainingTargetEnumerations: MAX_TARGET_ENUMERATIONS, isExhausted: false },
});
