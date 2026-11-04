import type { PrimitiveValue } from "../types";

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
