import type { SymbolicValue } from "../types";

const OBJECT_KINDS = new Set<SymbolicValue["kind"]>([
  "JsxExpression",
  "JsxFragment",
  "Function",
  "ObjectExpression",
  "ArrayExpression",
]);

export const isObjectValue = (value: SymbolicValue): boolean => OBJECT_KINDS.has(value.kind);
