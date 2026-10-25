import { UNDEFINED_VALUE } from "../symbolic-values";
import type { SymbolicValue } from "../types";

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
  const valuesByKey = new Map(value.properties.map((property) => [property.key, property.value]));
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

export const getLiteralRead = (
  receiver: SymbolicValue,
  methodName: string,
  argumentValues: SymbolicValue[],
): SymbolicValue | null => {
  const [argument] = argumentValues;
  if (receiver.kind === "ArrayExpression" && receiver.spreads.length === 0 && methodName === "at")
    return argument?.kind === "Primitive" && Number.isInteger(argument.value)
      ? (receiver.elements.at(Number(argument.value)) ?? UNDEFINED_VALUE)
      : null;
  const isObject =
    receiver.kind === "Global" && receiver.module === null && receiver.name === "Object";
  return isObject && argument && OBJECT_READS.has(methodName)
    ? readObject(methodName, argument)
    : null;
};
