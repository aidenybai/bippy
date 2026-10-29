import type { BinaryOperator } from "./types";

export const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
export const NEGATED_EQUALITY_OPERATORS = new Set(["!==", "!="]);
export const STRICT_EQUALITY_OPERATORS = new Set(["===", "!=="]);
export const COMPARISON_OPERATORS = new Set([...EQUALITY_OPERATORS, "<", "<=", ">", ">="]);
export const BOUND_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "=="]);
export const ORDER_OPERATORS = new Set(["<", "<=", ">", ">="]);
export const MIRRORED_OPERATORS = new Map<BinaryOperator, BinaryOperator>([
  ["<", ">"],
  ["<=", ">="],
  [">", "<"],
  [">=", "<="],
]);
