import type { SymbolicValue } from "../types";

const BOOLEAN_OPERATORS = new Set(["===", "!==", "==", "!=", "<", "<=", ">", ">="]);

export const isBooleanExpression = (value: SymbolicValue): boolean =>
  (value.kind === "BinaryExpression" && BOOLEAN_OPERATORS.has(value.operator)) ||
  (value.kind === "UnaryExpression" && value.operator === "!");
