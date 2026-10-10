import type { Expression } from "./model.ts";

const BINARY_PRECEDENCE: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "===": 4,
  "!==": 4,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

export const getAtomKey = (slot: string, path: string[]): string => [slot, ...path].join(".");

const getPrecedence = (expression: Expression): number => {
  if (expression.kind === "binary") return BINARY_PRECEDENCE[expression.operator] ?? 0;
  if (expression.kind === "conditional") return 0;
  return 10;
};

const wrap = (expression: Expression, minimumPrecedence: number): string => {
  const text = formatExpression(expression);
  return getPrecedence(expression) < minimumPrecedence ? `(${text})` : text;
};

export const formatExpression = (expression: Expression): string => {
  switch (expression.kind) {
    case "literal":
      return expression.text;
    case "slot":
      return getAtomKey(expression.slot, expression.path);
    case "unary":
      return `${expression.operator}${wrap(expression.operand, 10)}`;
    case "binary": {
      const precedence = BINARY_PRECEDENCE[expression.operator] ?? 0;
      return `${wrap(expression.left, precedence)} ${expression.operator} ${wrap(expression.right, precedence + 1)}`;
    }
    case "conditional":
      return `${wrap(expression.condition, 1)} ? ${formatExpression(expression.whenTrue)} : ${formatExpression(expression.whenFalse)}`;
    case "object":
      return `{ ${expression.fields.map((field) => (field.name === "..." ? `...${formatExpression(field.value)}` : `${field.name}: ${formatExpression(field.value)}`)).join(", ")} }`;
    case "array": {
      const parts = [
        ...expression.spreads.map((spread) => `...${formatExpression(spread)}`),
        ...(expression.itemCount > 0 ? [`${expression.itemCount} new`] : []),
      ];
      return `[${parts.join(", ")}]`;
    }
    case "opaque":
      return `Unknown(${expression.reason}: ${expression.text.replace(/\s+/g, " ")})`;
  }
};

export const negate = (expression: Expression): Expression =>
  expression.kind === "unary" && expression.operator === "!"
    ? expression.operand
    : { kind: "unary", operator: "!", operand: expression };
