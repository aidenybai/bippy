import type { PrimitiveValue } from "../types";
import type { Abstract } from "./types";

export type Comparison = "===" | "!==" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export const COMPARISONS = new Set<string>(["===", "!==", "==", "!=", "<", "<=", ">", ">="]);

export const ANY: Abstract = { kind: "Any" };

type RangeValue = Extract<Abstract, { kind: "Range" }>;

export const FLIPPED: Record<Comparison, Comparison> = {
  "===": "===",
  "!==": "!==",
  "==": "==",
  "!=": "!=",
  "<": ">",
  "<=": ">=",
  ">": "<",
  ">=": "<=",
};

const isNullish = (value: PrimitiveValue): value is null | undefined =>
  value === null || value === undefined;

const isNaNValue = (value: PrimitiveValue): boolean =>
  typeof value === "number" && Number.isNaN(value);

const isSameValue = (left: PrimitiveValue, right: PrimitiveValue): boolean =>
  left === right || (isNaNValue(left) && isNaNValue(right));

const isLooselyEqual = (left: PrimitiveValue, right: PrimitiveValue): boolean => {
  if (isNullish(left) || isNullish(right)) return isNullish(left) && isNullish(right);
  return typeof left === typeof right ? left === right : Number(left) === Number(right);
};

const isStrict = (operator: Comparison): boolean => operator === "===" || operator === "!==";

const compareValues = (
  left: PrimitiveValue,
  operator: Comparison,
  right: PrimitiveValue,
): boolean => {
  switch (operator) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      return isLooselyEqual(left, right);
    case "!=":
      return !isLooselyEqual(left, right);
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
  }
};

const isAbove = (min: number, isMinIncluded: boolean, value: number): boolean =>
  isMinIncluded ? value >= min : value > min;

const isBelow = (max: number, isMaxIncluded: boolean, value: number): boolean =>
  isMaxIncluded ? value <= max : value < max;

const isInRange = (range: RangeValue, value: number): boolean =>
  isAbove(range.min, range.isMinIncluded, value) && isBelow(range.max, range.isMaxIncluded, value);

const isSinglePoint = (range: RangeValue): boolean => range.min === range.max;

const getSample = (range: RangeValue): number => {
  if (isSinglePoint(range)) return range.min;
  if (range.min === -Infinity) return range.max === Infinity ? 0 : range.max - 1;
  return range.max === Infinity ? range.min + 1 : (range.min + range.max) / 2;
};

const getComparedNumber = (operator: Comparison, literal: PrimitiveValue): number | null => {
  if (isStrict(operator)) return typeof literal === "number" ? literal : null;
  if (isNullish(literal) && (operator === "==" || operator === "!=")) return null;
  return Number(literal);
};

const compareRange = (
  range: RangeValue,
  operator: Comparison,
  literal: PrimitiveValue,
): boolean | null => {
  const point = getComparedNumber(operator, literal);
  if (point !== null && isInRange(range, point) && !isSinglePoint(range)) return null;
  return compareValues(getSample(range), operator, literal);
};

const getEquality = (
  value: Abstract,
  operator: Comparison,
  literal: PrimitiveValue,
): boolean | null => {
  switch (value.kind) {
    case "Other":
      if (isStrict(operator))
        return (value.type === "string" && typeof literal !== "string") ||
          value.excluded.includes(literal)
          ? false
          : null;
      return value.type === "string" && isNullish(literal) ? false : null;
    case "Object":
      return isStrict(operator) || isNullish(literal) ? false : null;
    case "Truthy":
      return (isStrict(operator) ? !literal : isNullish(literal)) ? false : null;
    case "Falsy":
      return isStrict(operator) && literal ? false : null;
    default:
      return null;
  }
};

export const compareAbstract = (
  value: Abstract,
  operator: Comparison,
  literal: PrimitiveValue,
): boolean | null => {
  if (value.kind === "Exact") return compareValues(value.value, operator, literal);
  if (value.kind === "Range") return compareRange(value, operator, literal);
  const isEqual = getEquality(value, operator, literal);
  if (isEqual === null) return null;
  if (operator === "===" || operator === "==") return isEqual;
  return operator === "!==" || operator === "!=" ? !isEqual : null;
};

const isRangeBelow = (left: RangeValue, right: RangeValue): boolean =>
  left.max < right.min || (left.max === right.min && !(left.isMaxIncluded && right.isMinIncluded));

export const compareAbstracts = (
  left: Abstract,
  operator: Comparison,
  right: Abstract,
): boolean | null => {
  if (right.kind === "Exact") return compareAbstract(left, operator, right.value);
  if (left.kind === "Exact") return compareAbstract(right, FLIPPED[operator], left.value);
  if (left.kind !== "Range" || right.kind !== "Range") return null;
  if (isRangeBelow(left, right)) return compareValues(0, operator, 1);
  if (isRangeBelow(right, left)) return compareValues(1, operator, 0);
  return null;
};

export const getAbstractTruthiness = (value: Abstract): boolean | null => {
  switch (value.kind) {
    case "Exact":
      return Boolean(value.value);
    case "Range":
      return isInRange(value, 0) ? (value.min === 0 && value.max === 0 ? false : null) : true;
    case "Other":
      return value.excluded.includes("") && value.type === "string" ? true : null;
    case "Object":
    case "Truthy":
      return true;
    case "Falsy":
      return false;
    case "Any":
      return null;
  }
};

const containsExact = (container: Abstract, value: PrimitiveValue): boolean => {
  switch (container.kind) {
    case "Exact":
      return isSameValue(container.value, value);
    case "Range":
      return typeof value === "number" && isInRange(container, value);
    case "Other":
      return (
        (container.type === "any" || typeof value === "string") &&
        !container.excluded.includes(value)
      );
    case "Object":
      return false;
    case "Truthy":
      return Boolean(value);
    case "Falsy":
      return !value;
    case "Any":
      return true;
  }
};

const isPrimitive = (value: unknown): value is PrimitiveValue =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

export const containsValue = (container: Abstract, value: unknown): boolean =>
  isPrimitive(value)
    ? containsExact(container, value)
    : container.kind === "Object" ||
      container.kind === "Truthy" ||
      container.kind === "Any" ||
      (container.kind === "Other" && container.type === "any");
