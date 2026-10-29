import type { SymbolicValue } from "../types";
import { isObjectValue } from "./is-object-value";

const isNumberCase = (candidate: { kind: string; value?: unknown; primitive?: string | null }) =>
  candidate.kind === "Literal"
    ? typeof candidate.value === "number"
    : candidate.primitive === "number";

const isNumber = (value: SymbolicValue): boolean => {
  if (value.kind !== "Binding" || value.path.length > 0) return false;
  const { domain } = value.binding;
  if (domain.kind === "Opaque") return domain.typeText === "number";
  return domain.kind === "Cases" && domain.cases.every(isNumberCase);
};

const isNonEmptyText = (value: SymbolicValue): boolean =>
  value.kind === "BinaryExpression" && value.operator === "+"
    ? isNonEmptyText(value.left) || isNonEmptyText(value.right)
    : (value.kind === "Primitive" && typeof value.value === "string" && value.value !== "") ||
      isNumber(value);

export const getKnownTruthiness = (value: SymbolicValue): boolean | null => {
  if (value.kind === "Primitive") return Boolean(value.value);
  if (value.kind === "BinaryExpression") return isNonEmptyText(value) ? true : null;
  return isObjectValue(value) ? true : null;
};
