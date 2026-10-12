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
