import type { AssignmentOperator, BinaryOperator, UnaryOperator } from "@oxc-project/types";
import {
  getTruthiness,
  isNullish,
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

const REFERENCE_KINDS = new Set<StaticValue["kind"]>([
  "function",
  "component",
  "object",
  "array",
  "element",
  "namespace",
]);

const OBJECT_KINDS = new Set<StaticValue["kind"]>([...REFERENCE_KINDS, "regexp", "list"]);

const EQUALITY_OPERATORS = new Set<BinaryOperator>(["===", "==", "!==", "!="]);

/**
 * Whether a value known only by shape can equal `primitive`: an object never
 * strictly equals a primitive and is never loosely nullish, though it may
 * coerce to a string, number or boolean; a string is never nullish and only
 * strictly equals another string.
 */
const canEqualPrimitive = (
  value: StaticValue,
  primitive: Primitive,
  isStrict: boolean,
): boolean | null => {
  if (isNullish(primitive))
    return OBJECT_KINDS.has(value.kind) || value.kind === "text" ? false : null;
  if (!isStrict) return null;
  if (OBJECT_KINDS.has(value.kind)) return false;
  return value.kind === "text" && typeof primitive !== "string" ? false : null;
};

/** `left` and `right` are equal, when their shapes decide it; `null` otherwise. */
const decideEquality = (
  left: StaticValue,
  right: StaticValue,
  isStrict: boolean,
): boolean | null => {
  /** One static value stands for one runtime object; distinct values may still be the same object. */
  if (left === right && REFERENCE_KINDS.has(left.kind)) return true;
  if (right.kind === "literal") return canEqualPrimitive(left, right.value, isStrict);
  if (left.kind === "literal") return canEqualPrimitive(right, left.value, isStrict);
  return null;
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
  if (EQUALITY_OPERATORS.has(operator)) {
    const isEqual = decideEquality(left, right, operator === "===" || operator === "!==");
    if (isEqual !== null) return literal(operator.startsWith("!") ? !isEqual : isEqual);
  }
  if (operator === "+") {
    const isStringLike = (value: StaticValue): boolean =>
      value.kind === "text" || (value.kind === "literal" && typeof value.value === "string");
    if (isStringLike(left) || isStringLike(right)) return text(description);
  }
  return unknown(description);
};
