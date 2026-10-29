import type { PrimitiveTypeName } from "../types";

const isCanonicalIndex = (key: string | number): boolean =>
  String(Number(key)) === String(key) && !Number.isNaN(Number(key));

export const getPropertyKeyForms = (
  key: string | number,
  keyType: PrimitiveTypeName | null,
): Array<string | number> => {
  if (!isCanonicalIndex(key)) return [key];
  if (keyType === "number") return [Number(key)];
  if (keyType === "string") return [String(key)];
  return [Number(key), String(key)];
};
