import type { ParseNode } from "../../engine/dist/declaration/index.mjs";
import { SymbolicEngineError } from "./errors.js";
import { getScalarOperation, type ScalarOperation } from "./scalar-operation.js";

export interface ExpressionPlan {
  operations: Map<ParseNode, ScalarOperation>;
}

export const getExpressionPlan = (
  expression: ParseNode.Expression,
  inputs: ReadonlySet<string>,
): ExpressionPlan => {
  const plan: ExpressionPlan = { operations: new Map() };
  const reject = (node: ParseNode, reason: string): never => {
    throw new SymbolicEngineError(
      `${reason}: ${node.type} at ${node.location.start.line}:${node.location.start.column}`,
    );
  };
  const visit = (node: ParseNode.Expression, depth = 0): boolean => {
    if (depth > 128) reject(node, "Expression nesting exceeds the supported budget");
    switch (node.type) {
      case "NumericLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        return false;
      case "ParenthesizedExpression":
        return visit(node.Expression, depth + 1);
      case "IdentifierReference":
        if (["undefined", "NaN", "Infinity"].includes(node.name)) return false;
        if (!inputs.has(node.name)) reject(node, "Declare the unknown Boolean input explicitly");
        return true;
      default: {
        const operation = getScalarOperation(node);
        if (!operation) return reject(node, "Outside the supported pure scalar-expression subset");
        const children = operation.children.map((child) => visit(child, depth + 1));
        const isSymbolic = children.some(Boolean);
        if (isSymbolic) plan.operations.set(node, operation);
        return isSymbolic;
      }
    }
  };
  visit(expression);
  return plan;
};
