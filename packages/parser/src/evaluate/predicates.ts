import type {
  StaticBranchValue,
  StaticListValue,
  StaticPrimitiveValue,
  StaticRepeatValue,
  StaticValue,
} from "../types.js";
import { getListLength, getTruthiness, unknownPrimitiveValue } from "./values.js";
import { rangedNumberValue } from "./primitive-shapes.js";
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
const namedPredicates = new WeakMap<StaticValue, string>();

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
  const isNegated = outcomes[0] === TRUTHY_OUTCOME || outcomes[0].startsWith(NEGATED_PREFIX);
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
      : (namedPredicates.get(subject) ?? `truthy(${getSubjectId(subject)})`);
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

const getRepeatRoot = (repeat: StaticRepeatValue): StaticValue => {
  let root: StaticValue = repeat;
  for (let source = repeatSources.get(root); source; source = repeatSources.get(root))
    root = source;
  return root;
};

const COUNT_NAME = "count";
const COUNT_ABOVE_NAME = "countAbove";

/** The predicate deciding how many items a repeat has; null when nothing else depends on the count. */
export const getRepeatCountPredicate = (repeat: StaticRepeatValue): string | null => {
  const root = getRepeatRoot(repeat);
  return root !== repeat || sharedCountSources.has(repeat)
    ? `${COUNT_NAME}(${getSubjectId(root)})`
    : null;
};

const repeatLengths = new WeakMap<StaticValue, StaticRepeatValue>();

const getCountAbovePredicate = (repeat: StaticRepeatValue, threshold: number): string => {
  const root = getRepeatRoot(repeat);
  sharedCountSources.add(root);
  return `${COUNT_ABOVE_NAME}(${getSubjectId(root)},${threshold})`;
};

/**
 * The `.length` of a repeated list: a number within the count's bounds, truthy
 * exactly when the repeat has an item, so the test and the repeat decide together.
 */
export const getRepeatLength = (repeat: StaticRepeatValue): StaticValue => {
  const length = rangedNumberValue("length of a repeated list", {
    min: repeat.count?.min ?? 0,
    max: repeat.count?.max ?? Number.POSITIVE_INFINITY,
  });
  repeatLengths.set(length, repeat);
  namedPredicates.set(length, getCountAbovePredicate(repeat, 0));
  return length;
};

/** The `.length` of a list; a list that is one repeat is as long as the repeat. */
export const getCountedListLength = (list: StaticListValue): StaticValue => {
  const [onlyItem] = list.items;
  return list.items.length === 1 && onlyItem?.kind === "repeat"
    ? getRepeatLength(onlyItem)
    : getListLength(list);
};

const FLIPPED_COMPARISONS: Record<string, string> = {
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

interface CountThreshold {
  threshold: number;
  isNegated: boolean;
}

/** `length <op> literal` as `count > threshold`, possibly negated; null for comparisons that are not one. */
const toCountThreshold = (operator: string, literal: number): CountThreshold | null => {
  switch (operator) {
    case ">":
      return { threshold: literal, isNegated: false };
    case ">=":
      return { threshold: literal - 1, isNegated: false };
    case "<":
      return { threshold: literal - 1, isNegated: true };
    case "<=":
      return { threshold: literal, isNegated: true };
    case "===":
    case "==":
      return literal === 0 ? { threshold: 0, isNegated: true } : null;
    case "!==":
    case "!=":
      return literal === 0 ? { threshold: 0, isNegated: false } : null;
    default:
      return null;
  }
};

/** A comparison of a repeated list's length with an integer literal, named after the count it decides. */
export const getRepeatCountComparison = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue | null => {
  const isFlipped = !repeatLengths.has(left);
  const [length, other] = isFlipped ? [right, left] : [left, right];
  const repeat = repeatLengths.get(length);
  if (!repeat || other.kind !== "primitive" || typeof other.value !== "number") return null;
  if (!Number.isInteger(other.value)) return null;
  const bounds = toCountThreshold(
    isFlipped ? (FLIPPED_COMPARISONS[operator] ?? operator) : operator,
    other.value,
  );
  if (!bounds) return null;
  const predicate = getCountAbovePredicate(repeat, bounds.threshold);
  const result = unknownPrimitiveValue("boolean", `${operator} on dynamic values`);
  namedPredicates.set(result, bounds.isNegated ? getNegatedPredicate(predicate) : predicate);
  return result;
};

const equalities = new WeakMap<StaticValue, Map<string, StaticValue>>();

const EQUALITY_OPERATORS = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
} as const;

const getPrimitiveKey = (other: StaticPrimitiveValue): string =>
  `${typeof other.value} ${String(other.value)}`;

const getEqualityKey = (operator: keyof typeof EQUALITY_OPERATORS, other: StaticValue): string =>
  other.kind === "primitive"
    ? `${operator} ${getPrimitiveKey(other)}`
    : `${operator} #${getSubjectId(other)}`;

const EQUALS_NAME = "equals";
const DIFFERS_NAME = "differs";

/**
 * A strict comparison with a literal is named after the literal, so two such
 * comparisons of one value against different literals are known to exclude
 * each other (`x === "a"` being true decides `x === "b"`).
 */
const getStrictEqualityPredicate = (
  operator: keyof typeof EQUALITY_OPERATORS,
  subject: StaticValue,
  other: StaticValue,
): string | null => {
  if (other.kind !== "primitive" || (operator !== "===" && operator !== "!==")) return null;
  const name = operator === "===" ? EQUALS_NAME : DIFFERS_NAME;
  return `${name}(${getSubjectId(subject)},${JSON.stringify(getPrimitiveKey(other))})`;
};

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
  const named = getStrictEqualityPredicate(operator, subject, other);
  if (named !== null) namedPredicates.set(result, named);
  byKey.set(key, opposite ? recordNegation(result, opposite) : result);
  return result;
};

/** `equals(subject,key)` / `differs(subject,key)`: a strict comparison of a value with a literal. */
export interface EqualityPredicate {
  kind: "equality";
  subject: string;
  key: string;
  isNegated: boolean;
}

/** `truthy(decision:[outcome, ...])`: the truthiness of a decided value, one outcome per alternative. */
export interface DerivedPredicate {
  kind: "derived";
  decision: string;
  outcomes: string[];
}

/** `countAbove(subject,threshold)`: a repeat with the count `count(subject)` has more than `threshold` items. */
export interface CountPredicate {
  kind: "count";
  subject: string;
  threshold: number;
}

export interface ParsedPredicate {
  predicate: EqualityPredicate | DerivedPredicate | CountPredicate;
  /** The repeat-iteration suffix the state space appended to the variable. */
  scope: string;
}

const skipQuoted = (text: string, start: number): number => {
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    if (text[cursor] === "\\") cursor++;
    else if (text[cursor] === '"') return cursor + 1;
  }
  return text.length;
};

/** Index of the first `target` at nesting depth 0 from `start`, outside quoted keys; -1 when absent. */
const findAtDepth = (text: string, target: string, start: number): number => {
  let depth = 0;
  for (let cursor = start; cursor < text.length; ) {
    const char = text[cursor];
    if (char === '"') {
      cursor = skipQuoted(text, cursor);
      continue;
    }
    if (depth === 0 && char === target) return cursor;
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    cursor++;
  }
  return -1;
};

const splitAtDepth = (text: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  for (let comma = findAtDepth(text, ",", 0); comma !== -1; comma = findAtDepth(text, ",", start)) {
    parts.push(text.slice(start, comma));
    start = comma + 1;
  }
  parts.push(text.slice(start));
  return parts;
};

/** Reads the structure of a predicate the state space can decide from other decisions; null for opaque ones. */
export const parsePredicate = (variable: string): ParsedPredicate | null => {
  const open = variable.indexOf("(");
  if (open === -1) return null;
  const close = findAtDepth(variable, ")", open + 1);
  if (close === -1) return null;
  const name = variable.slice(0, open);
  const body = variable.slice(open + 1, close);
  const scope = variable.slice(close + 1);
  if (name === EQUALS_NAME || name === DIFFERS_NAME) {
    const [subject, key] = splitAtDepth(body);
    if (key === undefined) return null;
    return {
      predicate: { kind: "equality", subject, key, isNegated: name === DIFFERS_NAME },
      scope,
    };
  }
  if (name === COUNT_ABOVE_NAME) {
    const [subject, threshold] = splitAtDepth(body);
    if (threshold === undefined) return null;
    return { predicate: { kind: "count", subject, threshold: Number(threshold) }, scope };
  }
  if (name === "truthy") {
    const colon = findAtDepth(body, ":", 0);
    if (colon === -1 || !body.endsWith("]")) return null;
    return {
      predicate: {
        kind: "derived",
        decision: body.slice(0, colon),
        outcomes: splitAtDepth(body.slice(colon + 2, -1)),
      },
      scope,
    };
  }
  return null;
};

export interface PredicatePolarity {
  predicate: string;
  isNegated: boolean;
}

export const readPolarity = (predicate: string): PredicatePolarity =>
  predicate.startsWith(NEGATED_PREFIX)
    ? { predicate: predicate.slice(NEGATED_PREFIX.length), isNegated: true }
    : { predicate, isNegated: false };

/** The count variable of the repeat a `countAbove` predicate speaks about. */
export const getCountVariable = (subject: string): string => `${COUNT_NAME}(${subject})`;

export interface CountVariable {
  subject: string;
  scope: string;
}

/** Reads a repeat's `count(subject)` variable; null for a repeat whose count nothing else depends on. */
export const parseCountVariable = (variable: string): CountVariable | null => {
  const prefix = `${COUNT_NAME}(`;
  if (!variable.startsWith(prefix)) return null;
  const close = variable.indexOf(")", prefix.length);
  if (close === -1) return null;
  return { subject: variable.slice(prefix.length, close), scope: variable.slice(close + 1) };
};

export { TRUTHY_OUTCOME, FALSY_OUTCOME };
