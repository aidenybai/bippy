import type { PrimitiveValue } from "../types";
import type { Abstract } from "./types";

export type Comparison = "===" | "!==" | "==" | "!=" | "<" | "<=" | ">" | ">=";

export const COMPARISONS = new Set<string>(["===", "!==", "==", "!=", "<", "<=", ">", ">="]);

export const ANY: Abstract = { kind: "Any" };

const isNullish = (value: PrimitiveValue): value is null | undefined =>
  value === null || value === undefined;

const isLooselyEqual = (left: PrimitiveValue, right: PrimitiveValue): boolean => {
  if (isNullish(left) || isNullish(right)) return isNullish(left) && isNullish(right);
  return typeof left === typeof right ? left === right : Number(left) === Number(right);
};

const compareExact = (
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

const isInRange = (range: Extract<Abstract, { kind: "Range" }>, value: number): boolean =>
  isAbove(range.min, range.isMinIncluded, value) && isBelow(range.max, range.isMaxIncluded, value);

const compareRange = (
  range: Extract<Abstract, { kind: "Range" }>,
  operator: Comparison,
  literal: PrimitiveValue,
): boolean | null => {
  if (typeof literal !== "number") {
    if (operator === "===" || operator === "==") return false;
    if (operator === "!==" || operator === "!=") return true;
    return null;
  }
  const isSinglePoint = range.min === range.max && range.isMinIncluded && range.isMaxIncluded;
  const contains = isInRange(range, literal);
  switch (operator) {
    case "===":
    case "==":
      return isSinglePoint ? contains : contains ? null : false;
    case "!==":
    case "!=":
      return isSinglePoint ? !contains : contains ? null : true;
    case "<":
      return range.max < literal || (range.max === literal && !range.isMaxIncluded)
        ? true
        : range.min >= literal
          ? false
          : null;
    case "<=":
      return range.max <= literal
        ? true
        : range.min > literal || (range.min === literal && !range.isMinIncluded)
          ? false
          : null;
    case ">":
      return range.min > literal || (range.min === literal && !range.isMinIncluded)
        ? true
        : range.max <= literal
          ? false
          : null;
    case ">=":
      return range.min >= literal
        ? true
        : range.max < literal || (range.max === literal && !range.isMaxIncluded)
          ? false
          : null;
  }
};

const isEqualityOperator = (operator: Comparison): boolean =>
  operator === "===" || operator === "==";

const isInequalityOperator = (operator: Comparison): boolean =>
  operator === "!==" || operator === "!=";

const compareByTruthiness = (
  isTruthy: boolean,
  operator: Comparison,
  literal: PrimitiveValue,
): boolean | null => {
  if (!isEqualityOperator(operator) && !isInequalityOperator(operator)) return null;
  if (Boolean(literal) === isTruthy) return null;
  return isInequalityOperator(operator);
};

export const compareAbstract = (
  value: Abstract,
  operator: Comparison,
  literal: PrimitiveValue,
): boolean | null => {
  switch (value.kind) {
    case "Exact":
      return compareExact(value.value, operator, literal);
    case "Range":
      return compareRange(value, operator, literal);
    case "Other": {
      if (!isEqualityOperator(operator) && !isInequalityOperator(operator)) return null;
      const isOtherType = value.type === "string" && typeof literal !== "string";
      return isOtherType || value.excluded.includes(literal)
        ? isInequalityOperator(operator)
        : null;
    }
    case "Object":
      return isEqualityOperator(operator) || isInequalityOperator(operator)
        ? isInequalityOperator(operator)
        : null;
    case "Truthy":
      return compareByTruthiness(true, operator, literal);
    case "Falsy":
      return compareByTruthiness(false, operator, literal);
    case "Any":
      return null;
  }
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

const rangesOverlap = (
  left: Extract<Abstract, { kind: "Range" }>,
  right: Extract<Abstract, { kind: "Range" }>,
): boolean => {
  if (left.max < right.min || right.max < left.min) return false;
  if (left.max === right.min) return left.isMaxIncluded && right.isMinIncluded;
  if (right.max === left.min) return right.isMaxIncluded && left.isMinIncluded;
  return true;
};

const containsExact = (container: Abstract, value: PrimitiveValue): boolean => {
  switch (container.kind) {
    case "Exact":
      return container.value === value;
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

export const mayOverlap = (other: Abstract, value: Abstract): boolean => {
  if (other.kind === "Any" || value.kind === "Any") return true;
  if (value.kind === "Exact") return containsExact(other, value.value);
  if (other.kind === "Exact") return mayOverlap(value, other);
  switch (value.kind) {
    case "Range":
      if (other.kind === "Range") return rangesOverlap(other, value);
      if (other.kind === "Truthy") return !(value.min === 0 && value.max === 0);
      if (other.kind === "Falsy") return isInRange(value, 0);
      return other.kind === "Other" && other.type === "any";
    case "Other":
      if (other.kind === "Other") return true;
      if (other.kind === "Truthy") return true;
      if (other.kind === "Falsy") return !value.excluded.includes("");
      return value.type === "any" && other.kind !== "Range";
    case "Object":
      return other.kind === "Object" || other.kind === "Truthy" || other.kind === "Other";
    case "Truthy":
      return other.kind !== "Falsy";
    case "Falsy":
      return other.kind === "Falsy" || other.kind === "Other" || other.kind === "Range";
  }
};

export const shiftAbstract = (value: Abstract, amount: number): Abstract => {
  if (value.kind === "Exact" && typeof value.value === "number")
    return { kind: "Exact", value: value.value + amount };
  if (value.kind === "Range") return { ...value, min: value.min + amount, max: value.max + amount };
  return ANY;
};

const toRange = (value: Abstract): Extract<Abstract, { kind: "Range" }> | null => {
  if (value.kind === "Range") return value;
  if (value.kind === "Exact" && typeof value.value === "number")
    return {
      kind: "Range",
      min: value.value,
      max: value.value,
      isMinIncluded: true,
      isMaxIncluded: true,
    };
  return null;
};

export const addAbstract = (left: Abstract, right: Abstract): Abstract => {
  if (right.kind === "Exact" && typeof right.value === "number")
    return shiftAbstract(left, right.value);
  if (left.kind === "Exact" && typeof left.value === "number")
    return shiftAbstract(right, left.value);
  const leftRange = toRange(left);
  const rightRange = toRange(right);
  if (!leftRange || !rightRange) return ANY;
  return {
    kind: "Range",
    min: leftRange.min + rightRange.min,
    max: leftRange.max + rightRange.max,
    isMinIncluded: leftRange.isMinIncluded && rightRange.isMinIncluded,
    isMaxIncluded: leftRange.isMaxIncluded && rightRange.isMaxIncluded,
  };
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
