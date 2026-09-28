import type { NumericExpression, NumericPredicate } from "../../src/index.js";

export const getExpressionSource = (expression: NumericExpression): string => {
  if (expression.kind === "input") return `inputs[${JSON.stringify(expression.name)}]`;
  if (expression.kind === "constant") return expression.value;
  const operands = expression.operands.map(getExpressionSource);
  if (expression.operator === "unaryMinus") return `(-(${operands[0]}))`;
  if (expression.operator === "add") return `((${operands[0]})+(${operands[1]}))`;
  if (expression.operator === "subtract") return `((${operands[0]})-(${operands[1]}))`;
  throw new Error("Unsupported numeric expression operator");
};

export const getPredicateSource = (predicate: NumericPredicate): string =>
  predicate.kind === "constant"
    ? String(predicate.value)
    : `Object.is(${getExpressionSource(predicate.left)},${getExpressionSource(predicate.right)})`;
