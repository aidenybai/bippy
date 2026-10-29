import { SETTER_KEY_PREFIX } from "../../react-compiler/HIR/HIR";
import { UNDEFINED_VALUE } from "../values/symbolic-values";
import type { SymbolicValue } from "../types";
import { isStatelessRegExp } from "./is-stateless-regexp";

const OBJECT_READS = new Set(["keys", "values", "entries"]);

const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/;

const MAX_ARRAY_INDEX = 2 ** 32 - 2;

const isArrayIndex = (key: string): boolean =>
  ARRAY_INDEX_PATTERN.test(key) && Number(key) <= MAX_ARRAY_INDEX;

const getLiteralEntries = (value: SymbolicValue): Array<[string, SymbolicValue]> | null => {
  if (value.kind === "ArrayExpression")
    return value.spreads.length === 0
      ? value.elements.map((element, index) => [String(index), element])
      : null;
  if (value.kind !== "ObjectExpression" || value.spreads.length > 0) return null;
  const valuesByKey = new Map(
    value.properties
      .filter((property) => !property.key.startsWith(SETTER_KEY_PREFIX))
      .map((property) => [property.key, property.value]),
  );
  const keys = [...valuesByKey.keys()];
  const indexKeys = keys.filter(isArrayIndex).sort((left, right) => Number(left) - Number(right));
  return [...indexKeys, ...keys.filter((key) => !isArrayIndex(key))].map((key) => [
    key,
    valuesByKey.get(key) ?? UNDEFINED_VALUE,
  ]);
};

const toArray = (elements: SymbolicValue[]): SymbolicValue => ({
  kind: "ArrayExpression",
  elements,
  spreads: [],
});

const readObject = (methodName: string, target: SymbolicValue): SymbolicValue | null => {
  const entries = getLiteralEntries(target);
  if (!entries) return null;
  if (methodName === "keys")
    return toArray(entries.map(([key]) => ({ kind: "Primitive", value: key })));
  if (methodName === "values") return toArray(entries.map(([, value]) => value));
  return toArray(
    entries.map(([key, value]) => toArray([{ kind: "Primitive", value: key }, value])),
  );
};

const hasOwnKey = (target: SymbolicValue, key: SymbolicValue | undefined): SymbolicValue | null => {
  const entries = getLiteralEntries(target);
  return entries && key?.kind === "Primitive"
    ? { kind: "Primitive", value: entries.some(([entryKey]) => entryKey === String(key.value)) }
    : null;
};

const createRegExp = (pattern: string, flags: string): RegExp | null => {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
};

const testRegExp = (
  receiver: SymbolicValue,
  argument: SymbolicValue | undefined,
): SymbolicValue | null => {
  const regExp = isStatelessRegExp(receiver)
    ? createRegExp(receiver.pattern, receiver.flags)
    : null;
  return regExp && argument?.kind === "Primitive" && typeof argument.value === "string"
    ? { kind: "Primitive", value: regExp.test(argument.value) }
    : null;
};

const getConcatenatedCopy = (
  receiver: SymbolicValue,
  argumentValues: SymbolicValue[],
): SymbolicValue | null => {
  const isArrayState =
    receiver.kind === "Binding" &&
    receiver.path.length === 0 &&
    receiver.binding.initial?.kind === "ArrayExpression";
  return isArrayState && argumentValues.every((argument) => argument.kind === "Primitive")
    ? { kind: "ArrayExpression", elements: argumentValues, spreads: [receiver] }
    : null;
};

export const getLiteralRead = (
  receiver: SymbolicValue,
  methodName: string,
  argumentValues: SymbolicValue[],
): SymbolicValue | null => {
  const [argument] = argumentValues;
  if (methodName === "concat") return getConcatenatedCopy(receiver, argumentValues);
  if (methodName === "test") return testRegExp(receiver, argument);
  if (receiver.kind === "ArrayExpression" && receiver.spreads.length === 0 && methodName === "at")
    return argument?.kind === "Primitive" && Number.isInteger(argument.value)
      ? (receiver.elements.at(Number(argument.value)) ?? UNDEFINED_VALUE)
      : null;
  const isObject =
    receiver.kind === "Global" && receiver.module === null && receiver.name === "Object";
  if (isObject && argument && methodName === "hasOwn")
    return hasOwnKey(argument, argumentValues[1]);
  return isObject && argument && OBJECT_READS.has(methodName)
    ? readObject(methodName, argument)
    : null;
};
