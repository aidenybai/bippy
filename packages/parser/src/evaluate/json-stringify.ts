import type { StaticObjectValue, StaticValue, StringShape } from "../types.js";
import { isThrownOutcome } from "./promises.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  isCallable,
  isFunctionValue,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "./values.js";

// `JSON.stringify(value, replacer, space)` as ECMA-262 SerializeJSONProperty
// specifies it: `toJSON` and a replacer function run with the holder as `this`,
// an array replacer is the property allowlist, `space` sets the indentation.
// The result is known only while every visited part is; the first uncertain
// part names the reason the string is not.

export interface JsonStringifyTools {
  call: (callee: StaticValue, args: StaticValue[], thisValue: StaticValue) => StaticValue;
}

interface SerializationState {
  replacer: StaticValue | null;
  propertyList: readonly string[] | null;
  gap: string;
  tools: JsonStringifyTools;
  rootHolder: StaticValue;
}

/** The text of a serialized string opens with its quote, whatever the string. */
const JSON_STRING_SHAPE: StringShape = { prefix: '"', length: null };

class UncertainSerialization {
  constructor(readonly outcome: StaticValue) {}
}

const MAX_GAP_LENGTH = 10;

const gapOf = (space: StaticValue | undefined): string | null => {
  if (space === undefined || space.kind !== "primitive") return space === undefined ? "" : null;
  if (typeof space.value === "number") {
    return " ".repeat(Math.max(0, Math.min(MAX_GAP_LENGTH, Math.trunc(space.value))));
  }
  if (typeof space.value === "string") return space.value.slice(0, MAX_GAP_LENGTH);
  return "";
};

const propertyListOf = (replacer: StaticValue): readonly string[] | null | undefined => {
  if (!hasDefiniteItems(replacer)) return undefined;
  const keys: string[] = [];
  for (const item of replacer.items) {
    if (item.kind !== "primitive") return undefined;
    if (typeof item.value !== "string" && typeof item.value !== "number") continue;
    const key = String(item.value);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
};

const uncertain = (reason: string): never => {
  throw new UncertainSerialization(unknownPrimitiveValue("string", reason));
};

const checkedCall = (
  state: SerializationState,
  callee: StaticValue,
  args: StaticValue[],
  thisValue: StaticValue,
): StaticValue => {
  const result = state.tools.call(callee, args, thisValue);
  if (isThrownOutcome(result)) throw new UncertainSerialization(result);
  return result;
};

const serializeObject = (
  state: SerializationState,
  object: StaticObjectValue,
  indent: string,
): string => {
  const keys = state.propertyList ?? getKnownObjectKeys(object);
  if (keys === null) return uncertain("JSON.stringify of an object with uncertain keys");
  const stepback = indent;
  const innerIndent = indent + state.gap;
  const members: string[] = [];
  for (const key of keys) {
    const serialized = serializeValue(
      state,
      key,
      getObjectProperty(object, key),
      object,
      innerIndent,
    );
    if (serialized === undefined) continue;
    members.push(`${JSON.stringify(key)}:${state.gap === "" ? "" : " "}${serialized}`);
  }
  if (members.length === 0) return "{}";
  return state.gap === ""
    ? `{${members.join(",")}}`
    : `{\n${innerIndent}${members.join(`,\n${innerIndent}`)}\n${stepback}}`;
};

const serializeArray = (state: SerializationState, list: StaticValue, indent: string): string => {
  if (!hasDefiniteItems(list)) return uncertain("JSON.stringify of a list with uncertain items");
  const stepback = indent;
  const innerIndent = indent + state.gap;
  const members = list.items.map(
    (item, index) => serializeValue(state, String(index), item, list, innerIndent) ?? "null",
  );
  if (members.length === 0) return "[]";
  return state.gap === ""
    ? `[${members.join(",")}]`
    : `[\n${innerIndent}${members.join(`,\n${innerIndent}`)}\n${stepback}]`;
};

const serializeValue = (
  state: SerializationState,
  key: string,
  initial: StaticValue,
  holder: StaticValue,
  indent: string,
): string | undefined => {
  let value = initial;
  if (value.kind === "object") {
    const toJson = getObjectProperty(value, "toJSON");
    if (isCallable(toJson)) value = checkedCall(state, toJson, [primitiveValue(key)], value);
  }
  if (state.replacer) {
    value = checkedCall(state, state.replacer, [primitiveValue(key), value], holder);
  }
  switch (value.kind) {
    case "primitive": {
      const primitive = value.value;
      if (primitive === undefined || typeof primitive === "symbol") return undefined;
      if (typeof primitive === "bigint") return uncertain("JSON.stringify of a BigInt throws");
      if (typeof primitive === "number")
        return Number.isFinite(primitive) ? String(primitive) : "null";
      return JSON.stringify(primitive);
    }
    case "function":
    case "native-function":
    case "global":
    case "class":
      return undefined;
    case "list":
      return serializeArray(state, value, indent);
    case "object":
      return serializeObject(state, value, indent);
    case "unknown-primitive": {
      const reason = `JSON.stringify of ${value.reason}`;
      if (value.primitiveType !== "string" || holder !== state.rootHolder) return uncertain(reason);
      throw new UncertainSerialization({
        ...unknownPrimitiveValue("string", reason),
        stringShape: JSON_STRING_SHAPE,
      });
    }
    default:
      return uncertain(
        `JSON.stringify of ${value.kind === "unknown" ? value.reason : `a ${value.kind}`}`,
      );
  }
};

export const stringifyJson = (
  value: StaticValue | undefined,
  replacer: StaticValue | undefined,
  space: StaticValue | undefined,
  tools: JsonStringifyTools,
): StaticValue => {
  const gap = gapOf(space);
  if (gap === null)
    return unknownPrimitiveValue("string", "JSON.stringify with an uncertain space");
  const propertyList =
    replacer === undefined || isFunctionValue(replacer) ? null : propertyListOf(replacer);
  if (propertyList === undefined) {
    return unknownPrimitiveValue("string", "JSON.stringify with an uncertain replacer");
  }
  const root = value ?? UNDEFINED_VALUE;
  const holder = objectFromRecord({ "": root });
  const state: SerializationState = {
    replacer: replacer !== undefined && isFunctionValue(replacer) ? replacer : null,
    propertyList,
    gap,
    tools,
    rootHolder: holder,
  };
  try {
    const serialized = serializeValue(state, "", root, holder, "");
    return serialized === undefined ? UNDEFINED_VALUE : primitiveValue(serialized);
  } catch (error) {
    if (error instanceof UncertainSerialization) return error.outcome;
    throw error;
  }
};
