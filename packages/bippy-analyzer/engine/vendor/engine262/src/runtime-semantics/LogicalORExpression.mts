import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue, ToBoolean } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   LogicalORExpression :
//     LogicalORExpression `||` LogicalANDExpression
export function* Evaluate_LogicalORExpression({ LogicalORExpression, LogicalANDExpression }: ParseNode.LogicalORExpression): ValueEvaluator {
  // 1. Let lref be the result of evaluating LogicalORExpression.
  const lref = Q(yield* Evaluate(LogicalORExpression));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let lbool be ! ToBoolean(lval).
  const lbool = X(ToBoolean(lval));
  // 4. If lbool is true, return lval.
  if (lbool) {
    return lval;
  }
  // 5. Let rref be the result of evaluating LogicalANDExpression.
  const rref = Q(yield* Evaluate(LogicalANDExpression));
  // 6. Return ? GetValue(rref).
  return Q(yield* GetValue(rref));
}
