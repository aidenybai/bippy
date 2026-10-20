import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type {
  BinaryOperator,
  Binding,
  BindingValue,
  ConditionalValue,
  PrimitiveValue,
  SymbolicValue,
  TestKind,
  UnaryOperator,
} from "./types";
import { isBooleanExpression } from "./utils/is-boolean-expression";
import { isNullish } from "./utils/is-nullish";
import { isObjectValue } from "./utils/is-object-value";
import { getKnownTruthiness } from "./utils/get-known-truthiness";
import { negate } from "./utils/negate";

const MAX_OPTIONS_NESTING = 3;

export const UNDEFINED_VALUE: SymbolicValue = { kind: "Primitive", value: undefined };

export const START_TRANSITION_VALUE: SymbolicValue = {
  kind: "Global",
  name: "startTransition",
  module: "react",
};

export const isStartTransition = (value: SymbolicValue): boolean =>
  value.kind === "Global" && value.module === "react" && value.name === "startTransition";

export const ONE_VALUE: SymbolicValue = { kind: "Primitive", value: 1 };

export const getPassedCallbacks = (values: SymbolicValue[], depth = 0): SymbolicValue[] =>
  values.flatMap((value) => {
    if (
      value.kind === "Function" ||
      value.kind === "Setter" ||
      value.kind === "Dispatch" ||
      value.kind === "Bound"
    )
      return [value];
    if (value.kind === "Conditional")
      return getPassedCallbacks([value.consequent, value.alternate], depth);
    if (depth >= MAX_OPTIONS_NESTING) return [];
    if (value.kind === "ArrayExpression") return getPassedCallbacks(value.elements, depth + 1);
    if (value.kind !== "ObjectExpression") return [];
    return getPassedCallbacks(
      value.properties.map((property) => property.value),
      depth + 1,
    );
  });

export const getContainedValues = (value: SymbolicValue): SymbolicValue[] => {
  if (value.kind === "ObjectExpression")
    return value.properties.flatMap((property) => getContainedValues(property.value));
  if (value.kind === "ArrayExpression") return value.elements.flatMap(getContainedValues);
  return [value];
};

export const createUnknown = (reason: string, loc: SourceLocation): SymbolicValue => ({
  kind: "Unknown",
  reason,
  loc,
});

export const createBindingValue = (binding: Binding, path: string[] = []): BindingValue => ({
  kind: "Binding",
  binding,
  path,
});

const getKnownMembership = (key: SymbolicValue, object: SymbolicValue): boolean | null => {
  if (key.kind !== "Primitive" || object.kind !== "ObjectExpression") return null;
  const name = String(key.value);
  if (object.properties.some((property) => property.key === name)) return true;
  return object.spreads.length === 0 && !(name in Object.prototype) ? false : null;
};

const foldObjectComparison = (
  operator: BinaryOperator,
  primitive: PrimitiveValue,
): SymbolicValue | null => {
  const isLooseNullish = isNullish(primitive);
  if (operator === "===" || (operator === "==" && isLooseNullish))
    return { kind: "Primitive", value: false };
  if (operator === "!==" || (operator === "!=" && isLooseNullish))
    return { kind: "Primitive", value: true };
  return null;
};

const isOrdered = (value: PrimitiveValue): value is number | string =>
  typeof value === "number" || typeof value === "string";

const foldOrder = (
  operator: "<" | "<=" | ">" | ">=",
  left: PrimitiveValue,
  right: PrimitiveValue,
): SymbolicValue | null => {
  if (!isOrdered(left) || !isOrdered(right) || typeof left !== typeof right) return null;
  switch (operator) {
    case "<":
      return { kind: "Primitive", value: left < right };
    case "<=":
      return { kind: "Primitive", value: left <= right };
    case ">":
      return { kind: "Primitive", value: left > right };
    case ">=":
      return { kind: "Primitive", value: left >= right };
  }
};

const NUMBER_OPERATIONS: Partial<Record<BinaryOperator, (left: number, right: number) => number>> =
  {
    "+": (left, right) => left + right,
    "-": (left, right) => left - right,
    "*": (left, right) => left * right,
    "/": (left, right) => left / right,
    "%": (left, right) => left % right,
    "**": (left, right) => left ** right,
  };

export const foldBinary = (
  operator: BinaryOperator,
  left: SymbolicValue,
  right: SymbolicValue,
): SymbolicValue => {
  const membership = operator === "in" ? getKnownMembership(left, right) : null;
  if (membership !== null) return { kind: "Primitive", value: membership };
  const comparedPrimitive = isObjectValue(left) ? right : isObjectValue(right) ? left : null;
  const foldedComparison =
    comparedPrimitive?.kind === "Primitive"
      ? foldObjectComparison(operator, comparedPrimitive.value)
      : null;
  if (foldedComparison) return foldedComparison;
  if (left.kind !== "Primitive" || right.kind !== "Primitive")
    return { kind: "BinaryExpression", operator, left, right };
  const leftValue = left.value;
  const rightValue = right.value;
  const operation = NUMBER_OPERATIONS[operator];
  if (operation && typeof leftValue === "number" && typeof rightValue === "number")
    return { kind: "Primitive", value: operation(leftValue, rightValue) };
  if (operator === "+" && typeof leftValue === "string" && typeof rightValue === "string")
    return { kind: "Primitive", value: leftValue + rightValue };
  switch (operator) {
    case "===":
      return { kind: "Primitive", value: leftValue === rightValue };
    case "!==":
      return { kind: "Primitive", value: leftValue !== rightValue };
    case "==":
      // oxlint-disable-next-line eqeqeq -- Folds JavaScript loose equality as written.
      return { kind: "Primitive", value: leftValue == rightValue };
    case "!=":
      // oxlint-disable-next-line eqeqeq -- Folds JavaScript loose equality as written.
      return { kind: "Primitive", value: leftValue != rightValue };
    case "<":
    case "<=":
    case ">":
    case ">=":
      return (
        foldOrder(operator, leftValue, rightValue) ?? {
          kind: "BinaryExpression",
          operator,
          left,
          right,
        }
      );
    default:
      return { kind: "BinaryExpression", operator, left, right };
  }
};

export const getKnownOutcome = (test: SymbolicValue, testKind: TestKind): boolean | null => {
  if (testKind === "truthy") return getKnownTruthiness(test);
  if (isObjectValue(test)) return true;
  return test.kind === "Primitive" ? !isNullish(test.value) : null;
};

const isNegatedNonBoolean = (value: SymbolicValue): boolean =>
  value.kind === "UnaryExpression" && value.operator === "!" && !isBooleanExpression(value.value);

export const foldUnary = (operator: UnaryOperator, value: SymbolicValue): SymbolicValue => {
  if (operator === "!" && value.kind === "Primitive")
    return { kind: "Primitive", value: !value.value };
  if (operator === "!" && !isNegatedNonBoolean(value)) return negate(value);
  return { kind: "UnaryExpression", operator, value };
};

export const getShortCircuit = (
  value: SymbolicValue,
): Pick<ConditionalValue, "test" | "testKind"> | null =>
  value.kind === "Conditional" &&
  value.alternate.kind === "Primitive" &&
  value.alternate.value === undefined
    ? { test: value.test, testKind: value.testKind }
    : null;
