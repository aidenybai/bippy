import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type {
  BinaryOperator,
  Binding,
  BindingValue,
  ConditionalValue,
  SymbolicValue,
  TestKind,
  UnaryOperator,
} from "./types";
import { isNullish } from "./utils/checks";
import { getKnownTruthiness, negate } from "./utils/truthiness";

const MAX_OPTIONS_NESTING = 3;

export const UNDEFINED_VALUE: SymbolicValue = { kind: "Primitive", value: undefined };

export const getPassedCallbacks = (values: SymbolicValue[], depth = 0): SymbolicValue[] =>
  values.flatMap((value) => {
    if (value.kind === "Function" || value.kind === "Setter") return [value];
    if (value.kind === "Conditional")
      return getPassedCallbacks([value.consequent, value.alternate], depth);
    if (value.kind !== "ObjectExpression" || depth >= MAX_OPTIONS_NESTING) return [];
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
  operator: BinaryOperator,
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

export const foldUnary = (operator: UnaryOperator, value: SymbolicValue): SymbolicValue => {
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

export const getShortCircuit = (
  value: SymbolicValue,
): Pick<ConditionalValue, "test" | "testKind"> | null =>
  value.kind === "Conditional" &&
  value.alternate.kind === "Primitive" &&
  value.alternate.value === undefined
    ? { test: value.test, testKind: value.testKind }
    : null;
