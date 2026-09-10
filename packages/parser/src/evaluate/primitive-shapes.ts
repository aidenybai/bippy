import type { Class } from "oxc-parser";
import type {
  ComponentDefinition,
  FunctionLikeNode,
  NumberRange,
  StaticClassValue,
  StaticElementType,
  StaticFunctionValue,
  StaticObjectValue,
  StaticUnknownPrimitiveValue,
  StaticValue,
  StringComposition,
  StringShape,
} from "../types.js";
import { getBuiltinFunctionSource, getPrototypeWitness } from "./instance-of.js";
import {
  describeValue,
  distributeBinary,
  getPropertyName,
  hasDefiniteItems,
  hasOwnKey,
  mapValue,
  primitiveValue,
  regExpToString,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const UNKNOWN_STRING_SHAPE: StringShape = { prefix: "", minLength: 0, length: null };

const fixedLengthShape = (prefix: string, length: number | null): StringShape => ({
  prefix,
  minLength: length ?? prefix.length,
  length,
});

const shapedStringValue = (reason: string, shape: StringShape): StaticValue =>
  shape.length === shape.prefix.length
    ? primitiveValue(shape.prefix)
    : { ...unknownPrimitiveValue("string", reason), stringShape: shape };

/** `JSON.stringify(text)` of an unknown string: a quoted string, one per source text. */
export const quoteUnknownString = (
  text: StaticUnknownPrimitiveValue,
): StaticUnknownPrimitiveValue => {
  const composition = text.composition ?? { prefix: "", source: text, suffix: "" };
  return {
    ...unknownPrimitiveValue("string", "JSON.stringify"),
    stringShape: { prefix: '"', minLength: (text.stringShape?.minLength ?? 0) + 2, length: null },
    composition: {
      ...composition,
      prefix: `"${composition.prefix}`,
      suffix: `${composition.suffix}"`,
    },
  };
};

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

const PLAIN_OBJECT_TEXT = "[object Object]";

const CONVERSION_METHOD_KEYS = [
  "toString",
  "valueOf",
  "@@Symbol.toPrimitive",
  "@@Symbol.toStringTag",
];

const hasConversionOverride = (properties: Map<string, StaticValue>): boolean =>
  CONVERSION_METHOD_KEYS.some((key) => properties.has(key));

/** Whether a class chain defines its own conversion; null once the chain reaches a base the analysis cannot see. */
const classOverridesConversion = (classValue: StaticClassValue): boolean | null => {
  let current: StaticValue | null = classValue;
  while (current !== null) {
    if (current.kind !== "class") return null;
    const overrides: boolean = current.body.members.some(
      (member) => !member.isStatic && CONVERSION_METHOD_KEYS.includes(member.key),
    );
    if (overrides) return true;
    current = current.body.superValue;
  }
  return false;
};

/** Whether `Object.prototype.toString` is what `ToPrimitive` reaches for the object; null when its shape or prototype chain is not fully known. */
const isPlainObjectConversion = (object: StaticObjectValue): boolean | null => {
  for (const key of CONVERSION_METHOD_KEYS) {
    const isOwn = hasOwnKey(object, key);
    if (isOwn !== false) return isOwn === true ? false : null;
  }
  if (object.prototype) {
    const prototypeConversion = isPlainObjectConversion(object.prototype);
    if (prototypeConversion !== true) return prototypeConversion;
  }
  if (object.constructedBy) {
    const overrides = classOverridesConversion(object.constructedBy);
    if (overrides !== false) return overrides === true ? false : null;
  }
  const witness = getPrototypeWitness(object);
  return witness === null ? null : Object.getPrototypeOf(witness) === Object.prototype;
};

const NATIVE_FUNCTION_TEXT = "function () { [native code] }";

/** `Function.prototype.toString` where the text is fixed: V8's `[native code]` form for intrinsics and bound functions. */
const getFunctionSourceText = (receiver: StaticValue): string | null => {
  switch (receiver.kind) {
    case "function":
      return receiver.boundArgs || receiver.boundThis ? NATIVE_FUNCTION_TEXT : null;
    case "method":
      return receiver.receiver.kind === "global"
        ? getBuiltinFunctionSource(`${receiver.receiver.name}.${receiver.name}`)
        : receiver.receiver.kind === "external" || receiver.receiver.kind === "unknown"
          ? null
          : `function ${receiver.name}() { [native code] }`;
    case "global":
      return getBuiltinFunctionSource(receiver.name);
    default:
      return null;
  }
};

/**
 * What the served text of a program function opens with. Bundlers reprint the
 * module (types stripped, JSX compiled, whitespace renormalized) but keep the
 * `class` and `function` keywords and the parentheses around any arrow
 * parameter list other than a lone identifier; `async` may be compiled away
 * into a regenerator wrapper, so an async function claims nothing.
 */
const getServedTextPrefix = (node: FunctionLikeNode | Class, sourceText: string): string => {
  switch (node.type) {
    case "ClassDeclaration":
    case "ClassExpression":
      return "class";
    case "ArrowFunctionExpression":
      return node.async || (node.params.length === 1 && node.params[0].type === "Identifier")
        ? ""
        : "(";
    default:
      return node.async || !sourceText.startsWith("function", node.start) ? "" : "function";
  }
};

const servedFunctionTexts = new WeakMap<FunctionLikeNode | Class, StaticUnknownPrimitiveValue>();
const servedTextValues = new WeakSet<StaticUnknownPrimitiveValue>();

/** The text a program function or class reads back as: one value per node, so every closure of one function compares equal to the others. */
const getServedFunctionText = (
  callable: StaticFunctionValue | StaticClassValue | ComponentDefinition,
): StaticUnknownPrimitiveValue => {
  const cached = servedFunctionTexts.get(callable.node);
  if (cached) return cached;
  const prefix = getServedTextPrefix(callable.node, callable.module.file.sourceText);
  const text: StaticUnknownPrimitiveValue = {
    ...unknownPrimitiveValue(
      "string",
      `source text of ${callable.name ?? "an anonymous function"} as the bundler serves it`,
    ),
    stringShape: { prefix, minLength: prefix.length, length: null },
  };
  servedFunctionTexts.set(callable.node, text);
  servedTextValues.add(text);
  return text;
};

/** The served text of a program function, class or component, unless it converts through its own method. */
const getProgramFunctionText = (value: StaticValue): StaticUnknownPrimitiveValue | null => {
  switch (value.kind) {
    case "function":
    case "class":
      return hasConversionOverride(value.properties) ? null : getServedFunctionText(value);
    case "component-reference":
      return (value.type.kind === "function" || value.type.kind === "class") &&
        !hasConversionOverride(value.type.component.properties)
        ? getServedFunctionText(value.type.component)
        : null;
    default:
      return null;
  }
};

/** `Function.prototype.toString` of a callable; null when the receiver is not a modeled function. */
export const getFunctionText = (receiver: StaticValue): StaticValue | null => {
  const fixedText = getFunctionSourceText(receiver);
  if (fixedText !== null) return primitiveValue(fixedText);
  return receiver.kind === "function" || receiver.kind === "class"
    ? getServedFunctionText(receiver)
    : null;
};

/** Whether `key` is (or coerces to) the served text of a program function, which spells function syntax no program key does. */
export const isFunctionText = (key: StaticValue): boolean =>
  key.kind === "unknown-primitive"
    ? servedTextValues.has(key)
    : getProgramFunctionText(key) !== null;

const getComponentSourceText = (component: ComponentDefinition): string | null =>
  !hasConversionOverride(component.properties) && (component.boundArgs || component.boundThis)
    ? NATIVE_FUNCTION_TEXT
    : null;

/** `memo`/`forwardRef`/`lazy` results and context sides are plain objects; bound components read as native functions. */
const getElementTypeText = (type: StaticElementType): string | null => {
  switch (type.kind) {
    case "host":
      return type.tagName;
    case "function":
    case "class":
      return getComponentSourceText(type.component);
    case "memo":
    case "forward-ref":
    case "lazy":
      return hasConversionOverride(type.properties) ? null : PLAIN_OBJECT_TEXT;
    default:
      return PLAIN_OBJECT_ELEMENT_TYPES.has(type.kind) ? PLAIN_OBJECT_TEXT : null;
  }
};

const getJoinedItemText = (item: StaticValue): string | null =>
  item.kind === "primitive" && (item.value === null || item.value === undefined)
    ? ""
    : getCoercedText(item);

/**
 * `ToString(ToPrimitive(value, "string"))` when the text is statically decided:
 * `Object.prototype.toString` for plain objects (and React's element, context
 * and wrapper objects), `Function.prototype.toString` for bound functions,
 * `Array.prototype.join` for arrays. Null for symbols, for objects with their
 * own conversion methods, for program functions whose served text is not known
 * to the character, and for values the analysis cannot see.
 */
export const getCoercedText = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "symbol" ? null : String(value.value);
    case "function":
    case "class":
      return hasConversionOverride(value.properties) ? null : getFunctionSourceText(value);
    case "component-reference":
      return getElementTypeText(value.type);
    case "element":
    case "context":
      return PLAIN_OBJECT_TEXT;
    case "regexp":
      return regExpToString(value);
    case "list": {
      if (!hasDefiniteItems(value)) return null;
      if (
        value.properties &&
        (value.properties.has("join") || hasConversionOverride(value.properties))
      )
        return null;
      const texts = value.items.map(getJoinedItemText);
      return texts.every((text) => text !== null) ? texts.join(",") : null;
    }
    case "object":
      return isPlainObjectConversion(value) === true ? PLAIN_OBJECT_TEXT : null;
    default:
      return null;
  }
};

/** `ToPropertyKey`: symbols keep their identity, everything else is coerced to a string; null when the key is not statically known. */
export const toPropertyKey = (key: StaticValue): string | null =>
  getPropertyName(key) ?? getCoercedText(key);

/** How `value` reads once `+` coerces it to a string. */
const getConcatenationShape = (value: StaticValue): StringShape => {
  const text = getCoercedText(value);
  if (text !== null) return fixedLengthShape(text, text.length);
  const dynamicText =
    value.kind === "unknown-primitive" && value.primitiveType === "string"
      ? value
      : getProgramFunctionText(value);
  return dynamicText?.stringShape ?? UNKNOWN_STRING_SHAPE;
};

const getConcatenationComposition = (value: StaticValue): StringComposition | null => {
  if (value.kind === "unknown-primitive") {
    return value.composition ?? { prefix: "", source: value, suffix: "" };
  }
  return value.kind === "external" && value.origin === "derived"
    ? { prefix: "", source: value, suffix: "" }
    : null;
};

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
    minLength: leftShape.minLength + rightShape.minLength,
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

/** `String(value)`: primitives read as their text, RegExps as their source and arrays join their items, per alternative. */
export const toStringValue = (value: StaticValue): StaticValue =>
  mapValue(value, (alternative) => {
    const text = getCoercedText(alternative);
    if (text !== null) return primitiveValue(text);
    if (hasDefiniteItems(alternative)) return joinStrings(alternative.items, ",");
    if (alternative.kind === "unknown-primitive" && alternative.primitiveType === "string")
      return alternative;
    return (
      getProgramFunctionText(alternative) ??
      unknownPrimitiveValue("string", `String(${describeValue(alternative)})`)
    );
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
    return shapedStringValue(
      "slice()",
      fixedLengthShape(shape.prefix.slice(from, clampedTo), Math.max(0, clampedTo - from)),
    );
  }
  if (to !== null && to <= shape.prefix.length) return primitiveValue(shape.prefix.slice(from, to));
  return shapedStringValue("slice()", {
    prefix: shape.prefix.slice(from),
    minLength: Math.max(0, Math.min(shape.minLength, to ?? shape.minLength) - from),
    length: null,
  });
};

const toFixedOfRange = (range: NumberRange, digits: number): StaticValue | null => {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100) return null;
  if (range.min < 0 || range.max >= 9) return null;
  return shapedStringValue("toFixed()", fixedLengthShape("", digits === 0 ? 1 : digits + 2));
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
    min: shape?.minLength ?? 0,
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

/** Whether a dynamic property key may read as `name`: an unknown string of another prefix or length, or a number, never does. */
export const mayEqualPropertyKey = (key: StaticValue, name: string): boolean => {
  if (key.kind !== "unknown-primitive") return true;
  if (key.primitiveType === "number") return String(Number(name)) === name;
  if (key.primitiveType !== "string" || !key.stringShape) return true;
  const { prefix, length } = key.stringShape;
  return name.startsWith(prefix) && (length === null || name.length === length);
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
