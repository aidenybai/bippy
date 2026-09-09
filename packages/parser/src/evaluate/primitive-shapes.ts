import type {
  NumberRange,
  StaticElementType,
  StaticUnknownPrimitiveValue,
  StaticValue,
  StringComposition,
  StringShape,
} from "../types.js";
import {
  describeValue,
  distributeBinary,
  hasDefiniteItems,
  mapValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const UNKNOWN_STRING_SHAPE: StringShape = { prefix: "", length: null };

const shapedStringValue = (reason: string, shape: StringShape): StaticValue =>
  shape.length === shape.prefix.length
    ? primitiveValue(shape.prefix)
    : { ...unknownPrimitiveValue("string", reason), stringShape: shape };

export const rangedNumberValue = (
  reason: string,
  numberRange: NumberRange,
): StaticUnknownPrimitiveValue => ({ ...unknownPrimitiveValue("number", reason), numberRange });

const PLAIN_OBJECT_ELEMENT_TYPES = new Set<StaticElementType["kind"]>([
  "memo",
  "forward-ref",
  "lazy",
  "context-provider",
  "context-consumer",
]);

/** The text `value` coerces to when the language fixes it: primitives, and React's plain-object element types and elements. */
export const getCoercedText = (value: StaticValue): string | null => {
  if (value.kind === "primitive")
    return typeof value.value === "symbol" ? null : String(value.value);
  if (value.kind === "element" || value.kind === "context") return "[object Object]";
  if (value.kind === "component-reference" && PLAIN_OBJECT_ELEMENT_TYPES.has(value.type.kind)) {
    return "[object Object]";
  }
  return null;
};

/** How `value` reads once `+` coerces it to a string. */
const getConcatenationShape = (value: StaticValue): StringShape => {
  const text = getCoercedText(value);
  if (text !== null) return { prefix: text, length: text.length };
  if (value.kind === "unknown-primitive" && value.primitiveType === "string") {
    return value.stringShape ?? UNKNOWN_STRING_SHAPE;
  }
  return UNKNOWN_STRING_SHAPE;
};

const getConcatenationComposition = (value: StaticValue): StringComposition | null =>
  value.kind === "unknown-primitive"
    ? (value.composition ?? { prefix: "", source: value, suffix: "" })
    : null;

const composeStrings = (left: StaticValue, right: StaticValue): StringComposition | null => {
  const leftText = getCoercedText(left);
  const rightText = getCoercedText(right);
  if (leftText !== null) {
    const composition = getConcatenationComposition(right);
    return composition && { ...composition, prefix: leftText + composition.prefix };
  }
  if (rightText !== null) {
    const composition = getConcatenationComposition(left);
    return composition && { ...composition, suffix: composition.suffix + rightText };
  }
  return null;
};

export const concatenateStrings = (left: StaticValue, right: StaticValue): StaticValue => {
  const leftShape = getConcatenationShape(left);
  const rightShape = getConcatenationShape(right);
  const isLeftComplete = leftShape.length === leftShape.prefix.length;
  const concatenated = shapedStringValue("+ on dynamic values", {
    prefix: isLeftComplete ? leftShape.prefix + rightShape.prefix : leftShape.prefix,
    length:
      leftShape.length === null || rightShape.length === null
        ? null
        : leftShape.length + rightShape.length,
  });
  const composition = composeStrings(left, right);
  return concatenated.kind === "unknown-primitive" && composition
    ? { ...concatenated, composition }
    : concatenated;
};

/** `Array.prototype.join`: `null` and `undefined` items read as empty, every other item as its `+` coercion. */
const toJoinedItem = (item: StaticValue): StaticValue => {
  if (item.kind === "primitive" && (item.value === null || item.value === undefined))
    return primitiveValue("");
  return item.kind === "list" ? toStringValue(item) : item;
};

const concatenateAlternatives = (left: StaticValue, right: StaticValue): StaticValue =>
  distributeBinary(left, right, concatenateAlternatives) ?? concatenateStrings(left, right);

export const joinStrings = (items: StaticValue[], separator: string): StaticValue =>
  items.reduce<StaticValue>(
    (joined, item, index) =>
      concatenateAlternatives(
        index === 0 ? joined : concatenateAlternatives(joined, primitiveValue(separator)),
        toJoinedItem(item),
      ),
    primitiveValue(""),
  );

/** `String(value)`: primitives read as their text and arrays join their items, per alternative. */
export const toStringValue = (value: StaticValue): StaticValue =>
  mapValue(value, (alternative) => {
    if (alternative.kind === "primitive") return primitiveValue(String(alternative.value));
    if (hasDefiniteItems(alternative)) return joinStrings(alternative.items, ",");
    if (alternative.kind === "unknown-primitive" && alternative.primitiveType === "string")
      return alternative;
    return unknownPrimitiveValue("string", `String(${describeValue(alternative)})`);
  });

const toIndexArgument = (argument: StaticValue | undefined): number | null | undefined => {
  if (argument === undefined) return undefined;
  if (argument.kind !== "primitive" || typeof argument.value !== "number") return null;
  return Number.isInteger(argument.value) ? argument.value : null;
};

const sliceShapedString = (
  shape: StringShape,
  start: number,
  end: number | undefined,
): StaticValue | null => {
  const resolveIndex = (index: number): number | null =>
    index >= 0 ? index : shape.length === null ? null : Math.max(0, shape.length + index);
  const from = resolveIndex(start);
  if (from === null) return null;
  const to = end === undefined ? shape.length : resolveIndex(end);
  if (to === null && end !== undefined) return null;
  if (shape.length !== null) {
    const clampedTo = Math.min(to ?? shape.length, shape.length);
    return shapedStringValue("slice()", {
      prefix: shape.prefix.slice(from, clampedTo),
      length: Math.max(0, clampedTo - from),
    });
  }
  if (to !== null && to <= shape.prefix.length) return primitiveValue(shape.prefix.slice(from, to));
  return shapedStringValue("slice()", { prefix: shape.prefix.slice(from), length: null });
};

const toFixedOfRange = (range: NumberRange, digits: number): StaticValue | null => {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100) return null;
  if (range.min < 0 || range.max >= 9) return null;
  return shapedStringValue("toFixed()", { prefix: "", length: digits === 0 ? 1 : digits + 2 });
};

/** `text[index]`: the character when `index` falls inside the known prefix, `undefined` past a known length. */
export const getShapedStringCharacter = (
  receiver: StaticUnknownPrimitiveValue,
  index: number,
): StaticValue => {
  const shape = receiver.stringShape ?? UNKNOWN_STRING_SHAPE;
  if (index < shape.prefix.length) return primitiveValue(shape.prefix[index]);
  if (shape.length !== null && index >= shape.length) return primitiveValue(undefined);
  return unknownValue("character of dynamic string");
};

/** `.length` of a dynamic string: exact when its shape fixes it, else at least the known prefix's. */
export const getShapedStringLength = (receiver: StaticUnknownPrimitiveValue): StaticValue => {
  const shape = receiver.stringShape;
  if (shape?.length !== null && shape?.length !== undefined) return primitiveValue(shape.length);
  return rangedNumberValue("length of dynamic value", {
    min: shape?.prefix.length ?? 0,
    max: Number.POSITIVE_INFINITY,
  });
};

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

const startsWithShapedString = (shape: StringShape, search: string): StaticValue | null => {
  if (search.length <= shape.prefix.length) return primitiveValue(shape.prefix.startsWith(search));
  return shape.prefix === search.slice(0, shape.prefix.length) ? null : primitiveValue(false);
};

export const callShapedPrimitiveMethod = (
  receiver: StaticUnknownPrimitiveValue,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  const [first, second] = args;
  if (receiver.primitiveType === "string" && name === "slice") {
    const start = toIndexArgument(first) ?? 0;
    const end = toIndexArgument(second);
    if (start === null || end === null) return null;
    return sliceShapedString(receiver.stringShape ?? UNKNOWN_STRING_SHAPE, start, end);
  }
  if (receiver.primitiveType === "string" && name === "startsWith" && receiver.stringShape) {
    if (first?.kind !== "primitive" || typeof first.value !== "string" || second !== undefined) {
      return null;
    }
    return startsWithShapedString(receiver.stringShape, first.value);
  }
  if (receiver.primitiveType === "number" && name === "toFixed" && receiver.numberRange) {
    const digits = toIndexArgument(first) ?? 0;
    return digits === null ? null : toFixedOfRange(receiver.numberRange, digits);
  }
  return null;
};
