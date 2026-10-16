import type { AbstractValue, PrimitiveValue, BinaryOperator } from "../types";
import { isNullish } from "./is-nullish";

export const isEqualToLiteral = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: BinaryOperator,
): boolean => {
  if (value.kind !== "Literal") return false;
  if ((operator === "==" || operator === "!=") && isNullish(literal)) return isNullish(value.value);
  return value.value === literal;
};
