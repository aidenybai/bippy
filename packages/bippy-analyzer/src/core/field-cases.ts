import { evaluateCondition, type Constraints } from "./constraints";
import type { AbstractValue, Binding, SymbolicValue } from "./types";
import { getTestExpression } from "./utils/get-test-expression";
import { isWholeBinding } from "./utils/is-whole-binding";

export type FieldCases = AbstractValue[] | "unchanged" | null;

export const getLiteralCases = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind !== "Conditional") return null;
  const decidedOutcome = constraints
    ? evaluateCondition(getTestExpression(value), constraints)
    : null;
  if (decidedOutcome !== null)
    return getLiteralCases(decidedOutcome ? value.consequent : value.alternate, constraints);
  const consequentCases = getLiteralCases(value.consequent, constraints);
  const alternateCases = getLiteralCases(value.alternate, constraints);
  return consequentCases && alternateCases ? [...consequentCases, ...alternateCases] : null;
};

export const getFieldCases = (
  value: SymbolicValue | null,
  path: string[],
  binding: Binding,
  constraints: Constraints | null,
): FieldCases => {
  if (!value) return null;
  if (path.length === 0) return getLiteralCases(value, constraints);
  if (isWholeBinding(value, binding)) return "unchanged";
  if (value.kind !== "ObjectExpression") return null;
  const [field, ...restPath] = path;
  const assignedProperty = value.properties.findLast((property) => property.key === field);
  if (assignedProperty)
    return getFieldCases(assignedProperty.value, restPath, binding, constraints);
  return value.spreads.some((spread) => isWholeBinding(spread, binding)) ? "unchanged" : null;
};
