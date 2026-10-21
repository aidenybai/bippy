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
