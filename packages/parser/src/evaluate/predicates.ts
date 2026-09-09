import type { StaticValue } from "../types.js";
import { getTruthiness } from "./values.js";

// A branch predicate names the decision that picks an alternative. Two
// branches over the same decision (the same uncertain value tested twice, both
// sides of one fork, one state cell) share a predicate, so the state space
// enumerates them together instead of multiplying them.

const subjectIds = new WeakMap<object, number>();
let nextSubjectId = 0;

const getSubjectId = (subject: object): number => {
  const existing = subjectIds.get(subject);
  if (existing !== undefined) return existing;
  const id = ++nextSubjectId;
  subjectIds.set(subject, id);
  return id;
};

const negations = new WeakMap<StaticValue, StaticValue>();

/** Records that `negated` is `!operand`, so tests of either take opposite sides. */
export const recordNegation = (negated: StaticValue, operand: StaticValue): StaticValue => {
  negations.set(negated, operand);
  return negated;
};

const NEGATED_PREFIX = "!";

/** The predicate of a two-way branch taking the opposite side of `predicate`. */
export const getNegatedPredicate = (predicate: string): string =>
  predicate.startsWith(NEGATED_PREFIX)
    ? predicate.slice(NEGATED_PREFIX.length)
    : `${NEGATED_PREFIX}${predicate}`;

/**
 * A two-way branch whose sides differ in truthiness (`flag ? "a" : null`, or
 * `status === "exited"` distributed over a branch) is truthy exactly when its
 * own decision takes the truthy side, so testing it decides that same predicate.
 */
const getDecidedTruthinessPredicate = (subject: StaticValue): string | null => {
  if (subject.kind !== "branch" || subject.predicate === null || subject.alternatives.length !== 2)
    return null;
  const [first, second] = subject.alternatives.map(getTruthiness);
  if (first === true && second === false) return subject.predicate;
  if (first === false && second === true) return getNegatedPredicate(subject.predicate);
  return null;
};

/** The predicate of a branch whose first alternative is taken when `test` is truthy. */
export const getTruthinessPredicate = (test: StaticValue): string => {
  let subject = test;
  let isNegated = false;
  for (let operand = negations.get(subject); operand; operand = negations.get(subject)) {
    subject = operand;
    isNegated = !isNegated;
  }
  const predicate = getDecidedTruthinessPredicate(subject) ?? `truthy(${getSubjectId(subject)})`;
  return isNegated ? getNegatedPredicate(predicate) : predicate;
};

/** The predicate of a fork whose paths are decided by something the analysis cannot see. */
export const createPathPredicate = (): string => `path(${++nextSubjectId})`;

/** The predicate deciding which value a state cell holds in a committed tree. */
export const getStatePredicate = (cell: object): string => `state(${getSubjectId(cell)})`;
