import type { AssignmentOperator, BinaryOperator, UnaryOperator } from "@oxc-project/types";
import {
  getTruthiness,
  literal,
  type Primitive,
  type StaticValue,
  text,
  UNDEFINED,
  unknown,
} from "./values.js";

const COMPOUND_ASSIGNMENT_OPERATORS: Partial<Record<AssignmentOperator, BinaryOperator>> = {
  "+=": "+",
  "-=": "-",
  "*=": "*",
  "/=": "/",
  "%=": "%",
  "**=": "**",
  "<<=": "<<",
  ">>=": ">>",
  ">>>=": ">>>",
  "|=": "|",
  "^=": "^",
  "&=": "&",
};

/** The binary operator a compound assignment applies, or `null` for `=` and logical assignments. */
export const getBinaryOperator = (operator: AssignmentOperator): BinaryOperator | null =>
  COMPOUND_ASSIGNMENT_OPERATORS[operator] ?? null;

const typeOfValue = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "literal":
      return typeof value.value;
    case "text":
      return "string";
    case "regexp":
    case "array":
    case "list":
    case "object":
    case "element":
    case "namespace":
      return "object";
    case "function":
    case "component":
      return "function";
    default:
      return null;
  }
};

export const applyUnaryOperator = (
  operator: UnaryOperator,
  operand: StaticValue,
  description: string,
): StaticValue => {
  switch (operator) {
    case "!": {
      const truthiness = getTruthiness(operand);
      return truthiness === null ? unknown(description) : literal(!truthiness);
    }
    case "typeof": {
      const typeName = typeOfValue(operand);
      return typeName === null ? unknown(description) : literal(typeName);
    }
    case "void":
      return UNDEFINED;
    case "-":
    case "+":
    case "~":
      if (operand.kind === "literal" && typeof operand.value === "number") {
        const numeric = operand.value;
        return literal(operator === "-" ? -numeric : operator === "+" ? numeric : ~numeric);
      }
      return unknown(description);
    case "delete":
      return unknown(description);
  }
};

const foldPrimitives = (
  operator: BinaryOperator,
  left: Primitive,
  right: Primitive,
): Primitive | null => {
  switch (operator) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      // oxlint-disable-next-line eqeqeq -- folds the source's own loose comparison
      return left == right;
    case "!=":
      // oxlint-disable-next-line eqeqeq -- folds the source's own loose comparison
      return left != right;
    case "+":
      if (typeof left === "string" || typeof right === "string") {
        return `${String(left)}${String(right)}`;
      }
      if (typeof left === "number" && typeof right === "number") return left + right;
      return null;
  }
  if (typeof left !== "number" || typeof right !== "number") return null;
  switch (operator) {
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
    case "%":
      return left % right;
    case "**":
      return left ** right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      return null;
  }
};

export const applyBinaryOperator = (
  operator: BinaryOperator,
  left: StaticValue,
  right: StaticValue,
  description: string,
): StaticValue => {
  if (left.kind === "literal" && right.kind === "literal") {
    const folded = foldPrimitives(operator, left.value, right.value);
    if (folded !== null) return literal(folded);
  }
  if (operator === "+") {
    const isStringLike = (value: StaticValue): boolean =>
      value.kind === "text" || (value.kind === "literal" && typeof value.value === "string");
    if (isStringLike(left) || isStringLike(right)) return text(description);
  }
  return unknown(description);
};
