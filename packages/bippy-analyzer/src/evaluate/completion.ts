import type { SourceLocation } from "../parse/source-types.js";
import type { StaticValue } from "../types.js";
import { getTruthinessPredicate } from "./predicates.js";
import { getThrowCertainty } from "./thrown.js";
import {
  branchValue,
  FALSE_VALUE,
  getTruthiness,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

export type LoopJump = "break" | "continue";

/**
 * Result of evaluating a statement list. `returned` collects the values of every
 * path that returned; `mayComplete` is set when at least one path fell through
 * to the end of the list.
 */
export interface StatementOutcome {
  returned: StaticValue | null;
  mayComplete: boolean;
  completion?: StaticValue;
  settlementCondition?: StaticValue;
  /** Set when some path left the enclosing loop early; labeled jumps are `uncertain`. */
  jump: LoopJump | "uncertain" | null;
  /** When each labeled break is taken, keyed by label; `OTHER_JUMP` stands for every other jump. */
  jumpConditions?: Record<string, StaticValue>;
  /** The list stopped at an `await` of a pending promise; its rest runs once that settles. */
  isSuspended: boolean;
}

export const COMPLETES: StatementOutcome = {
  returned: null,
  mayComplete: true,
  jump: null,
  isSuspended: false,
};

export const SUSPENDED: StatementOutcome = {
  returned: null,
  mayComplete: false,
  jump: null,
  isSuspended: true,
};

const OTHER_JUMP = "";

export const jumpOutcome = (jump: LoopJump, label: string | null): StatementOutcome => ({
  returned: null,
  mayComplete: false,
  jump: label === null ? jump : "uncertain",
  jumpConditions: { [jump === "break" && label !== null ? label : OTHER_JUMP]: TRUE_VALUE },
  isSuspended: false,
});

const mergeJumps = (outcomes: StatementOutcome[]): StatementOutcome["jump"] => {
  const jumps = outcomes.map((outcome) => outcome.jump).filter((jump) => jump !== null);
  if (jumps.length === 0) return null;
  return jumps.every((jump) => jump === jumps[0]) ? jumps[0] : "uncertain";
};

const getJumpConditions = (outcome: StatementOutcome): Record<string, StaticValue> => {
  if (outcome.jump === null) return {};
  return outcome.jumpConditions ?? { [OTHER_JUMP]: TRUE_VALUE };
};

const mergeJumpConditions = (
  outcomes: StatementOutcome[],
  reason: string,
  location: SourceLocation | null,
  preferredOutcome: number,
  predicate: string | null,
): Record<string, StaticValue> | undefined => {
  const conditions = outcomes.map(getJumpConditions);
  const labels = [...new Set(conditions.flatMap(Object.keys))];
  if (labels.length === 0) return undefined;
  return Object.fromEntries(
    labels.map((label) => [
      label,
      branchValue(
        conditions.map((condition) => condition[label] ?? FALSE_VALUE),
        reason,
        location,
        preferredOutcome,
        predicate,
      ),
    ]),
  );
};

/** Every jumping path breaks out to a label, so the enclosing loop stops iterating and the jump propagates. */
export const isLabeledBreak = (outcome: StatementOutcome): boolean =>
  outcome.jump === "uncertain" && !(OTHER_JUMP in getJumpConditions(outcome));

/**
 * Paths that take the `key` jump complete here; other jumps keep propagating.
 * Paths that jump further share the joined state, so their later completions stay conservative.
 */
const completeJump = (outcome: StatementOutcome, key: string, reason: string): StatementOutcome => {
  const { [key]: condition, ...remaining } = getJumpConditions(outcome);
  const isJumping = Object.keys(remaining).length > 0;
  const jump = isJumping ? (key === OTHER_JUMP ? "uncertain" : outcome.jump) : null;
  if (!condition || getTruthiness(condition) === false) {
    return outcome.jump === null
      ? outcome
      : { ...outcome, jump, jumpConditions: isJumping ? remaining : undefined };
  }
  return {
    ...outcome,
    mayComplete: true,
    completion:
      getTruthiness(condition) === true
        ? TRUE_VALUE
        : branchValue(
            [TRUE_VALUE, getCompletionValue(outcome)],
            reason,
            null,
            0,
            getTruthinessPredicate(condition),
          ),
    jump,
    jumpConditions: isJumping ? remaining : undefined,
  };
};

/** A loop that has finished: its own breaks and continues end here, breaks to enclosing labels propagate. */
export const leaveLoop = (outcome: StatementOutcome): StatementOutcome =>
  completeJump(outcome, OTHER_JUMP, "leave loop");

/** A finished `switch` ends its own breaks; a `continue` keeps propagating to the enclosing loop. */
export const leaveSwitch = (outcome: StatementOutcome): StatementOutcome =>
  outcome.jump === "break" ? completeJump(outcome, OTHER_JUMP, "leave switch") : outcome;

export const consumeLabeledBreak = (outcome: StatementOutcome, label: string): StatementOutcome =>
  getJumpConditions(outcome)[label] ? completeJump(outcome, label, `break ${label}`) : outcome;

export const returnOutcome = (value: StaticValue): StatementOutcome => ({
  returned: value,
  mayComplete: false,
  jump: null,
  isSuspended: false,
});

export const getCompletionValue = (outcome: StatementOutcome): StaticValue => {
  if (!outcome.mayComplete) return FALSE_VALUE;
  if (outcome.returned === null && outcome.jump === null && !outcome.isSuspended) return TRUE_VALUE;
  return outcome.completion ?? unknownPrimitiveValue("boolean", "statement may complete");
};

export const getSettlementCondition = (outcome: StatementOutcome): StaticValue => {
  if (!outcome.isSuspended) return TRUE_VALUE;
  if (outcome.returned === null && !outcome.mayComplete) return FALSE_VALUE;
  return (
    outcome.settlementCondition ?? unknownPrimitiveValue("boolean", "async invocation may settle")
  );
};

export const outcomeToReturnValue = (
  outcome: StatementOutcome,
  location: SourceLocation | null,
): StaticValue => {
  if (!outcome.returned) return UNDEFINED_VALUE;
  if (!outcome.mayComplete) return outcome.returned;
  return branchValue(
    [outcome.returned, UNDEFINED_VALUE],
    "function may fall through without returning",
    location,
    0,
    getTruthinessPredicate(getCompletionValue(outcome), true),
  );
};

const isThrowingOutcome = (outcome: StatementOutcome): boolean =>
  outcome.returned !== null && getThrowCertainty(outcome.returned) === "always";

export const isPureReturn = (outcome: StatementOutcome): boolean =>
  outcome.returned !== null &&
  !outcome.mayComplete &&
  outcome.jump === null &&
  !outcome.isSuspended;

export const isPureCompletion = (outcome: StatementOutcome): boolean =>
  outcome.returned === null && outcome.mayComplete && outcome.jump === null && !outcome.isSuspended;

/** A path that certainly throws is never what a rendered tree took; prefer the first path that may produce a value. */
export const getPreferredOutcome = (
  outcomes: StatementOutcome[],
  preferredOutcome: number,
): number => {
  const preferred = outcomes[preferredOutcome];
  if (!preferred || !isThrowingOutcome(preferred)) return preferredOutcome;
  const survivor = outcomes.findIndex((outcome) => !isThrowingOutcome(outcome));
  return survivor === -1 ? preferredOutcome : survivor;
};

/**
 * `preferredBranch` is the index of the outcome the code is expected to take;
 * when that path completes without returning, the fall-through (last) outcome
 * is what it would return.
 */
export const mergeOutcomes = (
  outcomes: StatementOutcome[],
  reason: string,
  location: SourceLocation | null,
  preferredBranch = 0,
  predicate: string | null = null,
): StatementOutcome => {
  const returnedValues: StaticValue[] = [];
  let preferredIndex = 0;
  const preferredOutcome = getPreferredOutcome(outcomes, preferredBranch);
  const isFallThroughPreferred = !outcomes[preferredOutcome]?.returned;
  outcomes.forEach((outcome, index) => {
    if (!outcome.returned) return;
    if (index === preferredOutcome || (isFallThroughPreferred && index === outcomes.length - 1)) {
      preferredIndex = returnedValues.length;
    }
    returnedValues.push(outcome.returned);
  });
  return {
    returned:
      returnedValues.length > 0
        ? branchValue(
            returnedValues,
            reason,
            location,
            preferredIndex,
            returnedValues.length === outcomes.length ? predicate : null,
          )
        : null,
    mayComplete: outcomes.some((outcome) => outcome.mayComplete),
    completion: branchValue(
      outcomes.map(getCompletionValue),
      reason,
      location,
      preferredOutcome,
      predicate,
    ),
    settlementCondition: branchValue(
      outcomes.map(getSettlementCondition),
      reason,
      location,
      preferredOutcome,
      predicate,
    ),
    jump: mergeJumps(outcomes),
    jumpConditions: mergeJumpConditions(outcomes, reason, location, preferredOutcome, predicate),
    isSuspended: outcomes.some((outcome) => outcome.isSuspended),
  };
};
