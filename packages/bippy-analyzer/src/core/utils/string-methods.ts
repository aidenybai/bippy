import type { PrimitiveValue } from "../types";

const STRING_METHODS = new Set([
  "trim",
  "trimStart",
  "trimEnd",
  "toLowerCase",
  "toUpperCase",
  "startsWith",
  "endsWith",
  "includes",
  "indexOf",
  "slice",
  "charAt",
  "at",
  "padStart",
  "padEnd",
  "repeat",
  "replace",
  "replaceAll",
  "substring",
  "lastIndexOf",
]);

export const isStringMethod = (methodName: string): boolean => STRING_METHODS.has(methodName);

export const applyStringMethod = (
  methodName: string,
  receiver: string,
  argumentValues: PrimitiveValue[],
): PrimitiveValue => {
  const method: unknown = Reflect.get(String.prototype, methodName);
  const result: unknown =
    typeof method === "function" ? Reflect.apply(method, receiver, argumentValues) : undefined;
  return typeof result === "string" || typeof result === "number" || typeof result === "boolean"
    ? result
    : undefined;
};

export const applyArrayMethod = (
  methodName: string,
  receiver: PrimitiveValue[],
  argumentValues: PrimitiveValue[],
): PrimitiveValue | null => {
  const method: unknown = Reflect.get(Array.prototype, methodName);
  if (typeof method !== "function") return null;
  const result: unknown = Reflect.apply(method, receiver, argumentValues);
  return result === null ||
    result === undefined ||
    typeof result === "string" ||
    typeof result === "number" ||
    typeof result === "boolean"
    ? result
    : null;
};
