import type { StaticValue } from "../types.js";
import { getBinaryKind } from "./typed-arrays.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  isSymbolPropertyKey,
} from "./values.js";

export const getOwnEnumerableEntries = (
  target: StaticValue,
): [key: string, value: StaticValue][] | null => {
  if (target.kind === "object") {
    return getKnownObjectKeys(target)?.map((key) => [key, getObjectProperty(target, key)]) ?? null;
  }
  if (!hasDefiniteItems(target)) return null;
  return [
    ...(getBinaryKind(target) === "ArrayBuffer"
      ? []
      : target.items.map((item, index): [string, StaticValue] => [String(index), item])),
    ...[...(target.properties ?? [])].filter(
      ([key]) => !isSymbolPropertyKey(key) && !target.nonEnumerableKeys?.has(key),
    ),
  ];
};
