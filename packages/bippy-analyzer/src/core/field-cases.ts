import { evaluateCondition, type Constraints } from "./constraints";
import type { AbstractValue, Binding, BindingPlace, SymbolicValue } from "./types";
import { getBindingPlace } from "./utils/get-binding-place";
import { getTestExpression } from "./utils/get-test-expression";
import { isSamePlace } from "./utils/is-same-place";

export type FieldCases = AbstractValue[] | "unchanged" | null;

interface FieldWalk {
  target: BindingPlace;
  constraints: Constraints | null;
}

const resolveUnchanged = (cases: FieldCases, walk: FieldWalk): AbstractValue[] | null => {
  if (cases !== "unchanged") return cases;
  if (!walk.constraints) return [];
  return walk.constraints.possibleValues.get(walk.target) ?? null;
};

const getCases = (value: SymbolicValue, path: string[], walk: FieldWalk): FieldCases => {
  if (value.kind === "Binding") {
    const source = getBindingPlace(value.binding, [...value.path, ...path]);
    if (isSamePlace(source, walk.target)) return "unchanged";
    return walk.constraints?.possibleValues.get(source) ?? null;
  }
  if (value.kind === "Conditional") {
    const decidedOutcome = walk.constraints
      ? evaluateCondition(getTestExpression(value), walk.constraints)
      : null;
    if (decidedOutcome !== null)
      return getCases(decidedOutcome ? value.consequent : value.alternate, path, walk);
    const consequent = getCases(value.consequent, path, walk);
    const alternate = getCases(value.alternate, path, walk);
    if (consequent === "unchanged" && alternate === "unchanged") return "unchanged";
    const consequentCases = resolveUnchanged(consequent, walk);
    const alternateCases = resolveUnchanged(alternate, walk);
    return consequentCases && alternateCases ? [...consequentCases, ...alternateCases] : null;
  }
  if (path.length === 0)
    return value.kind === "Primitive" ? [{ kind: "Literal", value: value.value }] : null;
  if (value.kind !== "ObjectExpression") return null;
  const [field, ...restPath] = path;
  const assignedProperty = value.properties.findLast((property) => property.key === field);
  if (assignedProperty) return getCases(assignedProperty.value, restPath, walk);
  const spread = value.spreads.at(-1);
  return spread ? getCases(spread, path, walk) : null;
};

export const getFieldCases = (
  value: SymbolicValue | null,
  path: string[],
  binding: Binding,
  constraints: Constraints | null,
): FieldCases =>
  value ? getCases(value, path, { target: getBindingPlace(binding, path), constraints }) : null;
