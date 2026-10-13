import type { SourceLocation } from "../react-compiler/HIR/HIR.js";
import type { Binding, BindingValue, SymbolicValue, TestKind } from "./types.js";
import { isNullish } from "./utils/checks.js";
import { getKnownTruthiness, negate } from "./utils/truthiness.js";

const MAX_OPTIONS_DEPTH = 3;

export const UNDEFINED_VALUE: SymbolicValue = { kind: "Primitive", value: undefined };

export const getPassedCallbacks = (values: SymbolicValue[], depth = 0): SymbolicValue[] =>
  values.flatMap((value) => {
    if (value.kind === "Function" || value.kind === "Setter") return [value];
    if (value.kind === "Conditional")
      return getPassedCallbacks([value.consequent, value.alternate], depth);
    if (value.kind !== "ObjectExpression" || depth >= MAX_OPTIONS_DEPTH) return [];
    return getPassedCallbacks(
      value.properties.map((property) => property.value),
      depth + 1,
    );
  });

export const createUnknown = (reason: string, loc: SourceLocation): SymbolicValue => ({
  kind: "Unknown",
  reason,
  loc,
});

export const createBindingValue = (binding: Binding): BindingValue => ({
  kind: "Binding",
  binding,
  path: [],
});

export const foldBinary = (
  operator: string,
  left: SymbolicValue,
  right: SymbolicValue,
): SymbolicValue => {
  if (left.kind !== "Primitive" || right.kind !== "Primitive")
    return { kind: "BinaryExpression", operator, left, right };
  const leftValue = left.value;
  const rightValue = right.value;
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
    default:
      return { kind: "BinaryExpression", operator, left, right };
  }
};

export const getKnownOutcome = (test: SymbolicValue, testKind: TestKind): boolean | null => {
  if (testKind === "truthy") return getKnownTruthiness(test);
  return test.kind === "Primitive" ? test.value !== null && test.value !== undefined : null;
};

export const foldUnary = (operator: string, value: SymbolicValue): SymbolicValue => {
  if (operator === "!" && value.kind === "Primitive")
    return { kind: "Primitive", value: !value.value };
  if (operator === "!") return negate(value);
  return { kind: "UnaryExpression", operator, value };
};

export const getComponentName = (
  tag: Extract<SymbolicValue, { kind: "Global" | "Binding" }>,
): string => (tag.kind === "Global" ? tag.name : tag.binding.name);

export const isNullishValue = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" && isNullish(value.value);

// Assumes member accesses past the `?.` never throw.
export const getShortCircuit = (
  value: SymbolicValue,
): { test: SymbolicValue; testKind: TestKind } | null =>
  value.kind === "Conditional" &&
  value.alternate.kind === "Primitive" &&
  value.alternate.value === undefined
    ? { test: value.test, testKind: value.testKind }
    : null;
