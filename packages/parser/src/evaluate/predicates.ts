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

/** The predicate of a branch whose first alternative is taken when `test` is truthy. */
export const getTruthinessPredicate = (test: StaticValue): string => {
  if (test.kind === "branch" && test.predicate !== null && test.alternatives.length === 2) {
    const [whenFirst, whenSecond] = test.alternatives.map(getTruthiness);
    if (whenFirst === true && whenSecond === false) return test.predicate;
    if (whenFirst === false && whenSecond === true) return getNegatedPredicate(test.predicate);
  }
  let subject = test;
  let isNegated = false;
  for (let operand = negations.get(subject); operand; operand = negations.get(subject)) {
    subject = operand;
    isNegated = !isNegated;
  }
  return `${isNegated ? NEGATED_PREFIX : ""}truthy(${getSubjectId(subject)})`;
};

/** The predicate of a fork whose paths are decided by something the analysis cannot see. */
export const createPathPredicate = (): string => `path(${++nextSubjectId})`;

/** The predicate deciding which value a state cell holds in a committed tree. */
export const getStatePredicate = (cell: object): string => `state(${getSubjectId(cell)})`;
