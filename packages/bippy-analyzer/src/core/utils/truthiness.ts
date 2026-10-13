import type {
  AbstractValue,
  BinaryOperator,
  ConditionalValue,
  SymbolicValue,
  Truthiness,
} from "../types";

const NEGATED_OPERATORS = new Map<BinaryOperator, BinaryOperator>([
  ["===", "!=="],
  ["!==", "==="],
  ["==", "!="],
  ["!=", "=="],
  ["<", ">="],
  [">", "<="],
  ["<=", ">"],
  [">=", "<"],
]);

export const getNegatedOperator = (operator: BinaryOperator): BinaryOperator | null =>
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

export const getTestExpression = (
  branch: Pick<ConditionalValue, "test" | "testKind">,
): SymbolicValue =>
  branch.testKind === "nullish"
    ? {
        kind: "BinaryExpression",
        operator: "!=",
        left: branch.test,
        right: { kind: "Primitive", value: null },
      }
    : branch.test;

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
