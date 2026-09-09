import type { StaticBranchValue, StaticRepeatValue, StaticValue } from "../types.js";
import { getTruthiness, unknownPrimitiveValue } from "./values.js";
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

const getNegatedPredicate = (predicate: string): string =>
  predicate.startsWith(NEGATED_PREFIX)
    ? predicate.slice(NEGATED_PREFIX.length)
    : `${NEGATED_PREFIX}${predicate}`;

const TRUTHY_OUTCOME = "true";
const FALSY_OUTCOME = "false";

const negateOutcome = (outcome: string): string => {
  if (outcome === TRUTHY_OUTCOME) return FALSY_OUTCOME;
  if (outcome === FALSY_OUTCOME) return TRUTHY_OUTCOME;
  return getNegatedPredicate(outcome);
};

/**
 * Testing a branch decides nothing new: the outcome follows from the branch's
 * own decision and the truthiness of each alternative. Two tests agreeing (or
 * disagreeing) on every alternative of one decision are one predicate (or its
 * negation), whichever values carried them.
 */
const getBranchTruthinessPredicate = (branch: StaticBranchValue, predicate: string): string => {
  const outcomes = branch.alternatives.map((alternative) => {
    const truthiness = getTruthiness(alternative);
    if (truthiness !== null) return truthiness ? TRUTHY_OUTCOME : FALSY_OUTCOME;
    return getTruthinessPredicate(alternative);
  });
  const isNegated =
    outcomes[0] === TRUTHY_OUTCOME || outcomes[0].startsWith(NEGATED_PREFIX);
  const canonical = isNegated ? outcomes.map(negateOutcome) : outcomes;
  const combined = `truthy(${predicate}:[${canonical.join(",")}])`;
  return isNegated ? getNegatedPredicate(combined) : combined;
};

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
  const predicate =
    subject.kind === "branch" && subject.predicate !== null
      ? getBranchTruthinessPredicate(subject, subject.predicate)
      : `truthy(${getSubjectId(subject)})`;
  return isNegated ? getNegatedPredicate(predicate) : predicate;
};

/** The predicate of a fork whose paths are decided by something the analysis cannot see. */
export const createPathPredicate = (): string => `path(${++nextSubjectId})`;

/** The predicate deciding which value a state cell holds in a committed tree. */
export const getStatePredicate = (cell: object): string => `state(${getSubjectId(cell)})`;

const repeatSources = new WeakMap<StaticValue, StaticValue>();
const sharedCountSources = new WeakSet<StaticValue>();

/** Records that `derived` holds one item per item of `source` (`map`), so both have the same count. */
export const recordRepeatSource = (
  derived: StaticRepeatValue,
  source: StaticValue,
): StaticRepeatValue => {
  repeatSources.set(derived, source);
  sharedCountSources.add(source);
  return derived;
};

/** The predicate deciding how many items a repeat has; null when no other repeat shares the count. */
export const getRepeatCountPredicate = (repeat: StaticRepeatValue): string | null => {
  let root: StaticValue = repeat;
  for (let source = repeatSources.get(root); source; source = repeatSources.get(root)) root = source;
  return root !== repeat || sharedCountSources.has(repeat) ? `count(${getSubjectId(root)})` : null;
};

const equalities = new WeakMap<StaticValue, Map<string, StaticValue>>();

const EQUALITY_OPERATORS = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
} as const;

const getEqualityKey = (operator: keyof typeof EQUALITY_OPERATORS, other: StaticValue): string =>
  other.kind === "primitive"
    ? `${operator} ${typeof other.value} ${String(other.value)}`
    : `${operator} #${getSubjectId(other)}`;

/**
 * An undecidable equality asked again of the same values has the same answer,
 * and its inequality the opposite one; so `x === "a"` and `x !== "a"` in two
 * components decide one thing between them. The comparison asked first is the
 * decision; the opposite operator is read as its negation.
 */
export const getUncertainEquality = (
  operator: keyof typeof EQUALITY_OPERATORS,
  left: StaticValue,
  right: StaticValue,
): StaticValue => {
  const [subject, other] =
    left.kind === "primitive" ||
    (right.kind !== "primitive" && getSubjectId(right) < getSubjectId(left))
      ? [right, left]
      : [left, right];
  let byKey = equalities.get(subject);
  if (!byKey) {
    byKey = new Map();
    equalities.set(subject, byKey);
  }
  const key = getEqualityKey(operator, other);
  const cached = byKey.get(key);
  if (cached) return cached;
  const opposite = byKey.get(getEqualityKey(EQUALITY_OPERATORS[operator], other));
  const result = unknownPrimitiveValue("boolean", `${operator} on dynamic values`);
  byKey.set(key, opposite ? recordNegation(result, opposite) : result);
  return result;
};
