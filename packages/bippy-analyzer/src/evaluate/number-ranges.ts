import type { NumberRange, StaticUnknownPrimitiveValue, StaticValue } from "../types.js";
import { primitiveValue, unknownPrimitiveValue } from "./values.js";

export const rangedNumberValue = (
  reason: string,
  numberRange: NumberRange,
): StaticUnknownPrimitiveValue => ({ ...unknownPrimitiveValue("number", reason), numberRange });

const toNumberRange = (value: StaticValue): NumberRange | null => {
  if (value.kind === "primitive" && typeof value.value === "number" && !Number.isNaN(value.value)) {
    return { min: value.value, max: value.value };
  }
  return value.kind === "unknown-primitive" ? (value.numberRange ?? null) : null;
};

/** Orderings of two numbers that their ranges already decide; null while they overlap. */
export const compareNumberRanges = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue | null => {
  const leftRange = toNumberRange(left);
  const rightRange = toNumberRange(right);
  if (!leftRange || !rightRange) return null;
  const isBelow = leftRange.max < rightRange.min;
  const isAbove = leftRange.min > rightRange.max;
  const isAtMost = leftRange.max <= rightRange.min;
  const isAtLeast = leftRange.min >= rightRange.max;
  const decide = (isTrue: boolean, isFalse: boolean): StaticValue | null =>
    isTrue ? primitiveValue(true) : isFalse ? primitiveValue(false) : null;
  switch (operator) {
    case "<":
      return decide(isBelow, isAtLeast);
    case ">":
      return decide(isAbove, isAtMost);
    case "<=":
      return decide(isAtMost, isAbove);
    case ">=":
      return decide(isAtLeast, isBelow);
    case "===":
    case "==":
      return decide(false, isBelow || isAbove);
    case "!==":
    case "!=":
      return decide(isBelow || isAbove, false);
    default:
      return null;
  }
};

const rangeOf = (reason: string, bounds: number[]): StaticValue | null =>
  bounds.some(Number.isNaN)
    ? null
    : rangedNumberValue(reason, { min: Math.min(...bounds), max: Math.max(...bounds) });

/** Interval arithmetic on two numbers whose ranges are known; null when the result's range is not. */
export const applyNumberRangeOperator = (
  operator: string,
  left: StaticValue,
  right: StaticValue,
): StaticValue | null => {
  const leftRange = toNumberRange(left);
  const rightRange = toNumberRange(right);
  if (!leftRange || !rightRange) return null;
  const reason = `${operator} on dynamic values`;
  switch (operator) {
    case "+":
      return rangeOf(reason, [leftRange.min + rightRange.min, leftRange.max + rightRange.max]);
    case "-":
      return rangeOf(reason, [leftRange.min - rightRange.max, leftRange.max - rightRange.min]);
    case "*":
      return rangeOf(reason, [
        leftRange.min * rightRange.min,
        leftRange.min * rightRange.max,
        leftRange.max * rightRange.min,
        leftRange.max * rightRange.max,
      ]);
    case "/":
      if (rightRange.min <= 0 && rightRange.max >= 0) return null;
      return rangeOf(reason, [
        leftRange.min / rightRange.min,
        leftRange.min / rightRange.max,
        leftRange.max / rightRange.min,
        leftRange.max / rightRange.max,
      ]);
    default:
      return null;
  }
};

const ROUNDING_METHODS: Record<string, (value: number) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
};

/** `Math.<method>` over numbers whose ranges are known; null when the method or an argument's range is not. */
export const applyMathToRanges = (method: string, args: StaticValue[]): StaticValue | null => {
  const ranges = args.map(toNumberRange);
  if (ranges.length === 0 || !ranges.every((range) => range !== null)) return null;
  const reason = `Math.${method}`;
  const [first] = ranges;
  switch (method) {
    case "max":
      return rangeOf(reason, [
        Math.max(...ranges.map((range) => range.min)),
        Math.max(...ranges.map((range) => range.max)),
      ]);
    case "min":
      return rangeOf(reason, [
        Math.min(...ranges.map((range) => range.min)),
        Math.min(...ranges.map((range) => range.max)),
      ]);
    case "abs":
      if (ranges.length !== 1) return null;
      return first.min >= 0
        ? rangeOf(reason, [first.min, first.max])
        : first.max <= 0
          ? rangeOf(reason, [-first.max, -first.min])
          : rangeOf(reason, [0, Math.max(-first.min, first.max)]);
    default: {
      const round = ROUNDING_METHODS[method];
      if (!round || ranges.length !== 1) return null;
      return rangeOf(reason, [round(first.min), round(first.max)]);
    }
  }
};
