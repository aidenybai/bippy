import type { BinaryOperator } from "../types";

const NEGATED_OPERATORS = new Map<BinaryOperator, BinaryOperator>([
  ["===", "!=="],
  ["!==", "==="],
  ["==", "!="],
  ["!=", "=="],
  ["<", ">="],
  [">", "<="],
  ["<=", ">"],
  [">=", "<"],
]);

export const getNegatedOperator = (operator: BinaryOperator): BinaryOperator | null =>
  NEGATED_OPERATORS.get(operator) ?? null;
