import type {
  ComponentDefinition,
  StaticClassValue,
  StaticElementType,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { getBuiltinFunctionSource, getPrototypeWitness } from "./instance-of.js";
import { getPropertyName, hasDefiniteItems, hasOwnKey } from "./values.js";

const CONVERSION_METHOD_KEYS = [
  "toString",
  "valueOf",
  "@@Symbol.toPrimitive",
  "@@Symbol.toStringTag",
];

const PLAIN_OBJECT_TEXT = "[object Object]";

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

/** `Function.prototype.toString`: the source text of program functions, V8's `[native code]` form for intrinsics and bound functions. */
export const getFunctionSourceText = (receiver: StaticValue): string | null => {
  switch (receiver.kind) {
    case "function":
      return receiver.boundArgs || receiver.boundThis
        ? "function () { [native code] }"
        : receiver.module.file.sourceText.slice(receiver.node.start, receiver.node.end);
    case "class":
      return receiver.module.file.sourceText.slice(receiver.node.start, receiver.node.end);
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

const getComponentSourceText = (component: ComponentDefinition): string | null => {
  if (hasConversionOverride(component.properties)) return null;
  return component.boundArgs || component.boundThis
    ? "function () { [native code] }"
    : component.module.file.sourceText.slice(component.node.start, component.node.end);
};

/** `memo`/`forwardRef`/`lazy` results are plain objects; component functions and classes read as their source. */
const getElementTypeText = (type: StaticElementType): string | null => {
  switch (type.kind) {
    case "function":
    case "class":
      return getComponentSourceText(type.component);
    case "memo":
    case "forward-ref":
    case "lazy":
      return hasConversionOverride(type.properties) ? null : PLAIN_OBJECT_TEXT;
    default:
      return null;
  }
};

const getJoinedItemText = (item: StaticValue): string | null =>
  item.kind === "primitive" && (item.value === null || item.value === undefined)
    ? ""
    : getCoercedText(item);

/**
 * `ToString(ToPrimitive(value, "string"))` when the text is statically decided:
 * `Object.prototype.toString` for plain objects (and React's element and wrapper
 * objects), `Function.prototype.toString` for program functions,
 * `Array.prototype.join` for arrays. Null for symbols, for objects with their own
 * conversion methods, and for values the analysis cannot see.
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
      return PLAIN_OBJECT_TEXT;
    case "regexp":
      return `/${value.pattern}/${value.flags}`;
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
