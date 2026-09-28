import type { ParseNode, ValueEvaluator } from "../../engine/dist/declaration/index.mjs";
import type { SymbolicEngine } from "./load-engine.js";

export interface ScalarOperation {
  children: ParseNode.Expression[];
  operandCount: 1 | 2;
  evaluate: (api: SymbolicEngine["api"]) => ValueEvaluator;
}

export const getScalarOperation = (node: ParseNode.Expression): ScalarOperation | undefined => {
  switch (node.type) {
    case "UnaryExpression":
      if (node.operator === "delete") return undefined;
      return {
        children: [node.UnaryExpression],
        operandCount: 1,
        evaluate: (api) => api.Evaluate_UnaryExpression(node),
      };
    case "AdditiveExpression":
      return {
        children: [node.AdditiveExpression, node.MultiplicativeExpression],
        operandCount: 2,
        evaluate: (api) => api.Evaluate_AdditiveExpression(node),
      };
    case "MultiplicativeExpression":
      return {
        children: [node.MultiplicativeExpression, node.ExponentiationExpression],
        operandCount: 2,
        evaluate: (api) => api.Evaluate_MultiplicativeExpression(node),
      };
    case "ExponentiationExpression":
      return {
        children: [node.UpdateExpression, node.ExponentiationExpression],
        operandCount: 2,
        evaluate: (api) => api.Evaluate_ExponentiationExpression(node),
      };
    case "EqualityExpression":
      return {
        children: [node.EqualityExpression, node.RelationalExpression],
        operandCount: 2,
        evaluate: (api) => api.Evaluate_EqualityExpression(node),
      };
    case "RelationalExpression":
      if (!node.RelationalExpression || ["in", "instanceof"].includes(node.operator))
        return undefined;
      return {
        children: [node.RelationalExpression, node.ShiftExpression],
        operandCount: 2,
        evaluate: (api) => api.Evaluate_RelationalExpression(node),
      };
    case "ConditionalExpression":
      return {
        children: [
          node.ShortCircuitExpression,
          node.AssignmentExpression_a,
          node.AssignmentExpression_b,
        ],
        operandCount: 1,
        evaluate: (api) => api.Evaluate_ConditionalExpression(node),
      };
    case "LogicalANDExpression":
      return {
        children: [node.LogicalANDExpression, node.BitwiseORExpression],
        operandCount: 1,
        evaluate: (api) => api.Evaluate_LogicalANDExpression(node),
      };
    case "LogicalORExpression":
      return {
        children: [node.LogicalORExpression, node.LogicalANDExpression],
        operandCount: 1,
        evaluate: (api) => api.Evaluate_LogicalORExpression(node),
      };
    case "CoalesceExpression":
      return {
        children: [node.CoalesceExpressionHead, node.BitwiseORExpression],
        operandCount: 1,
        evaluate: (api) => api.Evaluate_CoalesceExpression(node),
      };
  }
};
