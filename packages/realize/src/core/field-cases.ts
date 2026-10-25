import { cloneConstraints, evaluateCondition, type Constraints } from "./constraints";
import { foldBinary } from "./symbolic-values";
import type { AbstractValue, Binding, BindingPlace, PrimitiveValue, SymbolicValue } from "./types";
import { applyPureFunctionToCases, isPureFunction } from "./utils/pure-functions";
import { getBindingPlace } from "./utils/get-binding-place";
import { getCollectionCases, getContentsField } from "./utils/literal-receivers";
import type { CollectionOwner } from "./utils/literal-receivers";
import { getValuePlace } from "./utils/get-value-place";
import { getTestExpression } from "./utils/get-test-expression";
import { isBooleanExpression } from "./utils/is-boolean-expression";
import { isSamePlace } from "./utils/is-same-place";

export type FieldCases = AbstractValue[] | "unchanged" | null;

interface FieldWalk {
  target: BindingPlace;
  constraints: Constraints | null;
  isFirstRender: boolean;
}

const ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%"]);

const MAX_ARITHMETIC_CASES = 64;

const getLiterals = (cases: FieldCases): PrimitiveValue[] | null => {
  if (!Array.isArray(cases) || cases.length === 0) return null;
  const literals = cases.flatMap((value) => (value.kind === "Literal" ? [value.value] : []));
  return literals.length === cases.length ? literals : null;
};

const toLiteralCases = (values: PrimitiveValue[] | null): FieldCases =>
  values && values.map((value) => ({ kind: "Literal", value }));

export const decideGuards = (
  guards: SymbolicValue[],
  constraints: Constraints,
  owner: CollectionOwner | null,
): boolean | null => {
  const narrowed = owner ? cloneConstraints(constraints) : constraints;
  if (owner) narrowed.possibleValues.set(getValuePlace(owner.source), [owner.value]);
  const outcomes = guards.map((guard) => evaluateCondition(guard, narrowed));
  if (outcomes.includes(false)) return false;
  return outcomes.every((outcome) => outcome === true) ? true : null;
};

const resolveUnchanged = (cases: FieldCases, walk: FieldWalk): AbstractValue[] | null => {
  if (cases !== "unchanged") return cases;
  if (!walk.constraints) return [];
  return walk.constraints.possibleValues.get(walk.target) ?? null;
};

const getFirstRenderCases = (value: SymbolicValue, walk: FieldWalk): FieldCases => {
  const derived =
    value.kind === "Binding" && value.path.length === 0 ? value.binding.derived : null;
  if (derived && "callee" in derived && isPureFunction(derived.callee)) {
    const operandCases = derived.operands.map((operand) =>
      getLiterals(getCases(operand, [], walk)),
    );
    if (operandCases.some((cases) => cases === null)) return null;
    const literals = operandCases.filter((cases): cases is PrimitiveValue[] => cases !== null);
    return toLiteralCases(applyPureFunctionToCases(derived.callee, literals));
  }
  if (value.kind !== "BinaryExpression" || !ARITHMETIC_OPERATORS.has(value.operator)) return null;
  const left = getLiterals(getCases(value.left, [], walk));
  const right = getLiterals(getCases(value.right, [], walk));
  if (!left || !right || left.length * right.length > MAX_ARITHMETIC_CASES) return null;
  const folded = left.flatMap((leftValue) =>
    right.map((rightValue) =>
      foldBinary(
        value.operator,
        { kind: "Primitive", value: leftValue },
        { kind: "Primitive", value: rightValue },
      ),
    ),
  );
  const literals = folded.flatMap((result) => (result.kind === "Primitive" ? [result.value] : []));
  return literals.length === folded.length ? toLiteralCases(literals) : null;
};

const getCases = (value: SymbolicValue, path: string[], walk: FieldWalk): FieldCases => {
  const firstRenderCases =
    walk.isFirstRender && path.length === 0 ? getFirstRenderCases(value, walk) : null;
  if (firstRenderCases) return firstRenderCases;
  if (value.kind === "Binding") {
    const source = getBindingPlace(value.binding, [...value.path, ...path]);
    if (isSamePlace(source, walk.target)) return "unchanged";
    const { domain } = value.binding;
    const domainCases = source.path.length === 0 && domain.kind === "Cases" ? domain.cases : null;
    return walk.constraints?.possibleValues.get(source) ?? domainCases;
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
  if (path.length === 0 && walk.constraints && isBooleanExpression(value)) {
    const outcome = evaluateCondition(value, walk.constraints);
    return outcome === null ? null : [{ kind: "Literal", value: outcome }];
  }
  if (value.kind === "Collection") {
    const { constraints } = walk;
    const contents = getCollectionCases(value, {
      read: (source) => constraints?.possibleValues.get(getValuePlace(source)),
      decide: (guards, owner) => (constraints ? decideGuards(guards, constraints, owner) : null),
    });
    return contents && getContentsField(contents, path);
  }
  if (path.length === 0)
    return value.kind === "Primitive" ? [{ kind: "Literal", value: value.value }] : null;
  const [field, ...restPath] = path;
  if (value.kind === "ArrayExpression" && field === "length" && restPath.length === 0)
    return value.spreads.length === 0 ? [{ kind: "Literal", value: value.elements.length }] : null;
  if (
    value.kind === "ArrayExpression" &&
    value.spreads.length === 0 &&
    /^(0|[1-9]\d*)$/.test(field)
  ) {
    const element = value.elements[Number(field)];
    if (element) return getCases(element, restPath, walk);
    return restPath.length === 0 ? [{ kind: "Literal", value: undefined }] : null;
  }
  if (value.kind !== "ObjectExpression") return null;
  const assignedProperty = value.properties.findLast((property) => property.key === field);
  if (assignedProperty) return getCases(assignedProperty.value, restPath, walk);
  const spread = value.spreads.at(-1);
  if (spread) return getCases(spread, path, walk);
  return restPath.length === 0 ? [{ kind: "Literal", value: undefined }] : null;
};

export const getFieldCases = (
  value: SymbolicValue | null,
  path: string[],
  binding: Binding,
  constraints: Constraints | null,
  isFirstRender = false,
): FieldCases =>
  value
    ? getCases(value, path, { target: getBindingPlace(binding, path), constraints, isFirstRender })
    : null;
