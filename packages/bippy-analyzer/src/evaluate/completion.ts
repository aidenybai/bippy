import type { SourceLocation } from "../parse/source-types.js";
import type { StaticValue } from "../types.js";
import { getTruthinessPredicate } from "./predicates.js";
import { getThrowCertainty } from "./thrown.js";
import {
  branchValue,
  FALSE_VALUE,
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
  /** Set when some path left the enclosing loop early; labeled jumps are `uncertain`. */
  jump: LoopJump | "uncertain" | null;
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

export const jumpOutcome = (jump: LoopJump, label: string | null): StatementOutcome => ({
  returned: null,
  mayComplete: false,
  jump: label === null ? jump : "uncertain",
  isSuspended: false,
});

const mergeJumps = (outcomes: StatementOutcome[]): StatementOutcome["jump"] => {
  const jumps = outcomes.map((outcome) => outcome.jump).filter((jump) => jump !== null);
  if (jumps.length === 0) return null;
  return jumps.every((jump) => jump === jumps[0]) ? jumps[0] : "uncertain";
};

export const returnOutcome = (value: StaticValue): StatementOutcome => ({
  returned: value,
  mayComplete: false,
  jump: null,
  isSuspended: false,
});

export const getCompletionValue = (outcome: StatementOutcome): StaticValue => {
  if (!outcome.mayComplete) return FALSE_VALUE;
  if (outcome.returned === null && outcome.jump === null) return TRUE_VALUE;
  return outcome.completion ?? unknownPrimitiveValue("boolean", "statement may complete");
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
  outcome.returned !== null && !outcome.mayComplete && outcome.jump === null;

export const isPureCompletion = (outcome: StatementOutcome): boolean =>
  outcome.returned === null && outcome.mayComplete && outcome.jump === null;

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
    jump: mergeJumps(outcomes),
    isSuspended: outcomes.some((outcome) => outcome.isSuspended),
  };
};
