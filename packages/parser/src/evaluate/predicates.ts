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
const refinements = new WeakMap<StaticValue, StaticValue>();

interface ResolvedSubject {
  subject: StaticValue;
  isNegated: boolean;
}

/** Follows `test` through the values it was refined from or negates. */
const resolveSubject = (
  test: StaticValue,
  onVisit?: (visited: StaticValue) => void,
): ResolvedSubject => {
  let subject = test;
  let isNegated = false;
  for (;;) {
    onVisit?.(subject);
    const refined = refinements.get(subject);
    if (refined) {
      subject = refined;
      continue;
    }
    const operand = negations.get(subject);
    if (!operand) return { subject, isNegated };
    subject = operand;
    isNegated = !isNegated;
  }
};

const isDerivedFrom = (subject: StaticValue, candidate: StaticValue): boolean => {
  let isFound = false;
  resolveSubject(subject, (visited) => {
    if (visited === candidate) isFound = true;
  });
  return isFound;
};

/** Records that `negated` is `!operand`, so tests of either take opposite sides. */
export const recordNegation = (negated: StaticValue, operand: StaticValue): StaticValue => {
  if (!isDerivedFrom(operand, negated)) negations.set(negated, operand);
  return negated;
};

/**
 * Records that `refined` is a branch rebuilt from `subject` by a test that
 * narrowed it (on one path, or rejoining both): it names the same runtime
 * value, so testing it again decides nothing new.
 */
export const recordRefinement = (refined: StaticValue, subject: StaticValue): void => {
  if (refined.kind === "branch" && !isDerivedFrom(subject, refined)) {
    refinements.set(refined, subject);
  }
};

const NEGATED_PREFIX = "!";

const describingSubjects = new Set<StaticValue>();
const subjectDescriptions = new WeakMap<StaticValue, string>();

/**
 * A branch over a named decision is truthy per alternative, so any copy of it
 * (a state read again, a property read off each alternative) tests the same.
 * An alternative refined from the branch itself names it by identity instead.
 */
const describeTruthinessSubject = (subject: StaticValue): string => {
  if (subject.kind !== "branch" || subject.predicate === null || describingSubjects.has(subject)) {
    return String(getSubjectId(subject));
  }
  const memoized = subjectDescriptions.get(subject);
  if (memoized !== undefined) return memoized;
  describingSubjects.add(subject);
  try {
    const alternatives = subject.alternatives.map(
      (alternative) => getTruthiness(alternative) ?? getTruthinessPredicate(alternative),
    );
    const description = `${subject.predicate} ? ${alternatives.join(" | ")}`;
    subjectDescriptions.set(subject, description);
    return description;
  } finally {
    describingSubjects.delete(subject);
  }
};

/** The predicate of a branch whose first alternative is taken when `test` is truthy. */
export const getTruthinessPredicate = (test: StaticValue): string => {
  const { subject, isNegated } = resolveSubject(test);
  return `${isNegated ? NEGATED_PREFIX : ""}truthy(${describeTruthinessSubject(subject)})`;
};

/** The predicate of a two-way branch taking the opposite side of `predicate`. */
export const getNegatedPredicate = (predicate: string): string =>
  predicate.startsWith(NEGATED_PREFIX)
    ? predicate.slice(NEGATED_PREFIX.length)
    : `${NEGATED_PREFIX}${predicate}`;

/** The predicate of a fork whose paths are decided by something the analysis cannot see. */
export const createPathPredicate = (): string => `path(${++nextSubjectId})`;

/** The predicate deciding which value a state cell holds in a committed tree. */
export const getStatePredicate = (cell: object): string => `state(${getSubjectId(cell)})`;
