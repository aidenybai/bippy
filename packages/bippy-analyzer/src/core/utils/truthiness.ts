import type { AbstractValue, SymbolicValue, TestKind, Truthiness } from "../types.js";

const NEGATED_OPERATORS = new Map<string, string>([
  ["===", "!=="],
  ["!==", "==="],
  ["==", "!="],
  ["!=", "=="],
  ["<", ">="],
  [">", "<="],
  ["<=", ">"],
  [">=", "<"],
]);

export const getNegatedOperator = (operator: string): string | null =>
  NEGATED_OPERATORS.get(operator) ?? null;

export const getTruthiness = (value: AbstractValue): Truthiness => {
  if (value.kind === "Literal") return value.value ? "truthy" : "falsy";
  if (value.text === "void") return "falsy";
  return value.primitive === null ? "truthy" : "either";
};

export const negate = (value: SymbolicValue): SymbolicValue =>
  value.kind === "UnaryExpression" && value.operator === "!"
    ? value.value
    : { kind: "UnaryExpression", operator: "!", value };

/**
 * The test a decision checks, as an expression: the value itself, or `value != null` for a
 * nullish test.
 */
export const getTestExpression = ({
  test,
  testKind,
}: {
  test: SymbolicValue;
  testKind: TestKind;
}): SymbolicValue =>
  testKind === "nullish"
    ? {
        kind: "BinaryExpression",
        operator: "!=",
        left: test,
        right: { kind: "Primitive", value: null },
      }
    : test;

/**
 * Whether a value is truthy no matter what the bindings hold: primitives by their value,
 * JSX, functions, objects and arrays always. `null` when it depends.
 */
export const getKnownTruthiness = (value: SymbolicValue): boolean | null => {
  switch (value.kind) {
    case "Primitive":
      return Boolean(value.value);
    case "JsxExpression":
    case "JsxFragment":
    case "Function":
    case "ObjectExpression":
    case "ArrayExpression":
      return true;
    default:
      return null;
  }
};
