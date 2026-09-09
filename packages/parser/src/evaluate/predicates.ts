import type { StaticValue } from "../types.js";

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

/** `operand === null`, `operand != undefined`: a test deciding whether `operand` is nullish. */
export interface NullishTest {
  operand: StaticValue;
  isEquality: boolean;
}

const nullishTests = new WeakMap<StaticValue, NullishTest>();

export const recordNullishTest = (
  test: StaticValue,
  operand: StaticValue,
  isEquality: boolean,
): StaticValue => {
  nullishTests.set(test, { operand, isEquality });
  return test;
};

export const getNullishTest = (test: StaticValue): NullishTest | null =>
  nullishTests.get(test) ?? null;

const NEGATED_PREFIX = "!";

export interface NegationChain {
  subject: StaticValue;
  isNegated: boolean;
}

/** `test` with its `!` layers peeled: the value they negate and whether an odd number were applied. */
export const resolveNegations = (test: StaticValue): NegationChain => {
  let subject = test;
  let isNegated = false;
  for (let operand = negations.get(subject); operand; operand = negations.get(subject)) {
    subject = operand;
    isNegated = !isNegated;
  }
  return { subject, isNegated };
};

/** The predicate of a two-way branch taking the opposite side of `predicate`. */
export const getNegatedPredicate = (predicate: string): string =>
  predicate.startsWith(NEGATED_PREFIX)
    ? predicate.slice(NEGATED_PREFIX.length)
    : `${NEGATED_PREFIX}${predicate}`;

const TRUTHY_KEY = "T";
const FALSY_KEY = "F";
const DERIVED_PREFIX = "truthy(";
const SUBJECT_SEPARATOR = "?";
const KEY_SEPARATOR = ":";

/** A truthiness test of a branch: decided by the branch's own decision, alternative by alternative. */
export interface DerivedPredicate {
  subject: string;
  /** Per alternative of `subject`: its truthiness when known, else the predicate deciding it. */
  outcomes: (boolean | string)[];
}

/** `text` split at the `separator`s outside parentheses. */
const splitOutsideParentheses = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
};

const readTruthinessKey = (key: string): boolean | string => {
  if (key === TRUTHY_KEY) return true;
  if (key === FALSY_KEY) return false;
  return /^\d+$/.test(key) ? `${DERIVED_PREFIX}${key})` : key;
};

/** Reads a `truthy(subject?key:key)` predicate back; null for predicates deciding a value directly. */
export const parseDerivedPredicate = (predicate: string): DerivedPredicate | null => {
  if (!predicate.startsWith(DERIVED_PREFIX) || !predicate.endsWith(")")) return null;
  const [subject, ...rest] = splitOutsideParentheses(
    predicate.slice(DERIVED_PREFIX.length, -1),
    SUBJECT_SEPARATOR,
  );
  if (rest.length === 0) return null;
  return {
    subject,
    outcomes: splitOutsideParentheses(rest.join(SUBJECT_SEPARATOR), KEY_SEPARATOR).map(
      readTruthinessKey,
    ),
  };
};

/**
 * What decides whether `alternative` is truthy: a literal verdict, the
 * decision of the branch it is, or the identity of the value itself.
 */
const getTruthinessKey = (alternative: StaticValue): string => {
  const { subject, isNegated } = resolveNegations(alternative);
  if (subject.kind === "primitive") {
    return Boolean(subject.value) !== isNegated ? TRUTHY_KEY : FALSY_KEY;
  }
  const key =
    subject.kind === "branch" && subject.predicate !== null
      ? getSubjectTruthinessPredicate(subject)
      : String(getSubjectId(subject));
  return isNegated ? getNegatedPredicate(key) : key;
};

/**
 * A branch over a known decision is truthy exactly when the alternative that
 * decision selects is, so two tests of values derived from the same decision
 * (`a || b` computed twice from the same `a` and `b`) share a predicate.
 */
const getSubjectTruthinessPredicate = (subject: StaticValue): string => {
  if (subject.kind !== "branch" || subject.predicate === null) {
    return `${DERIVED_PREFIX}${getSubjectId(subject)})`;
  }
  const keys = subject.alternatives.map(getTruthinessKey);
  if (keys.length === 2) {
    if (keys[0] === TRUTHY_KEY && keys[1] === FALSY_KEY) return subject.predicate;
    if (keys[0] === FALSY_KEY && keys[1] === TRUTHY_KEY)
      return getNegatedPredicate(subject.predicate);
  }
  return `${DERIVED_PREFIX}${subject.predicate}${SUBJECT_SEPARATOR}${keys.join(KEY_SEPARATOR)})`;
};

/** The predicate of a branch whose first alternative is taken when `test` is truthy. */
export const getTruthinessPredicate = (test: StaticValue): string => {
  const { subject, isNegated } = resolveNegations(test);
  const predicate = getSubjectTruthinessPredicate(subject);
  return isNegated ? getNegatedPredicate(predicate) : predicate;
};

/** The predicate of a fork whose paths are decided by something the analysis cannot see. */
export const createPathPredicate = (): string => `path(${++nextSubjectId})`;

/** The predicate deciding which value a state cell holds in a committed tree. */
export const getStatePredicate = (cell: object): string => `state(${getSubjectId(cell)})`;
