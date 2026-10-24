import type { AbstractValue, PrimitiveValue, BinaryOperator } from "../types";

export const LOOSE_EQUALITY_OPERATORS = new Set<BinaryOperator>(["==", "!="]);

export const isEqualToLiteral = (
  value: AbstractValue,
  literal: PrimitiveValue,
  operator: BinaryOperator,
): boolean => {
  if (value.kind !== "Literal") return false;
  if (!LOOSE_EQUALITY_OPERATORS.has(operator)) return value.value === literal;
  // oxlint-disable-next-line eqeqeq -- Decides JavaScript loose equality as written.
  return value.value == literal;
};
