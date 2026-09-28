import type { ParseNode } from "@engine262/engine262";
import { SymbolicEngineError } from "./errors.js";

export interface ExpressionPlan {
  conditions: Set<ParseNode.ConditionalExpression>;
  negations: Set<ParseNode.UnaryExpression>;
}

export const getExpressionPlan = (
  expression: ParseNode.Expression,
  inputs: ReadonlySet<string>,
): ExpressionPlan => {
  const plan: ExpressionPlan = { conditions: new Set(), negations: new Set() };
  const reject = (node: ParseNode, reason: string): never => {
    throw new SymbolicEngineError(
      `${reason}: ${node.type} at ${node.location.start.line}:${node.location.start.column}`,
    );
  };
  const visit = (node: ParseNode.Expression, isCondition = false, depth = 0): boolean => {
    if (depth > 128) reject(node, "Expression nesting exceeds the supported budget");
    const concrete = (child: ParseNode.Expression): void => {
      if (visit(child, false, depth + 1))
        reject(node, "Operations on symbolic results are not supported yet");
    };
    switch (node.type) {
      case "NumericLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        return false;
      case "ParenthesizedExpression":
        return visit(node.Expression, isCondition, depth + 1);
      case "IdentifierReference": {
        if (["undefined", "NaN", "Infinity"].includes(node.name)) return false;
        if (!inputs.has(node.name)) reject(node, "Declare the unknown Boolean input explicitly");
        if (!isCondition) reject(node, "Unknown Booleans are supported only as conditions");
        return true;
      }
      case "ConditionalExpression": {
        if (isCondition) reject(node, "Conditional results cannot be used as conditions yet");
        const isUnknown = visit(node.ShortCircuitExpression, true, depth + 1);
        const trueUnknown = visit(node.AssignmentExpression_a, false, depth + 1);
        const falseUnknown = visit(node.AssignmentExpression_b, false, depth + 1);
        if (isUnknown) plan.conditions.add(node);
        return isUnknown || trueUnknown || falseUnknown;
      }
      case "UnaryExpression": {
        if (node.operator === "delete") reject(node, "Mutation is unsupported");
        if (node.operator === "!" && isCondition) {
          const isUnknown = visit(node.UnaryExpression, true, depth + 1);
          if (isUnknown) plan.negations.add(node);
          return isUnknown;
        }
        concrete(node.UnaryExpression);
        return false;
      }
      case "AdditiveExpression":
        concrete(node.AdditiveExpression);
        concrete(node.MultiplicativeExpression);
        return false;
      case "MultiplicativeExpression":
        concrete(node.MultiplicativeExpression);
        concrete(node.ExponentiationExpression);
        return false;
      case "ExponentiationExpression":
        concrete(node.UpdateExpression);
        concrete(node.ExponentiationExpression);
        return false;
      case "EqualityExpression":
        concrete(node.EqualityExpression);
        concrete(node.RelationalExpression);
        return false;
      case "RelationalExpression":
        if (!node.RelationalExpression || ["in", "instanceof"].includes(node.operator))
          return reject(node, "Object operations are unsupported");
        concrete(node.RelationalExpression);
        concrete(node.ShiftExpression);
        return false;
      default:
        return reject(node, "Outside the supported pure conditional-expression subset");
    }
  };
  visit(expression);
  return plan;
};
