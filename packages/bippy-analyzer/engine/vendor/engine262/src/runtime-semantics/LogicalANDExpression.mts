import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue, ToBoolean } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   LogicalANDExpression :
//     LogicalANDExpression `&&` BitwiseORExpression
export function* Evaluate_LogicalANDExpression({ LogicalANDExpression, BitwiseORExpression }: ParseNode.LogicalANDExpression): ValueEvaluator {
  // 1. Let lref be the result of evaluating LogicalANDExpression.
  const lref = Q(yield* Evaluate(LogicalANDExpression));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let lbool be ! ToBoolean(lval).
  const lbool = X(ToBoolean(lval));
  // 4. If lbool is false, return lval.
  if (!lbool) {
    return lval;
  }
  // 5. Let rref be the result of evaluating BitwiseORExpression.
  const rref = Q(yield* Evaluate(BitwiseORExpression));
  // 6. Return ? GetValue(rref).
  return Q(yield* GetValue(rref));
}
