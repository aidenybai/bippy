import { Q } from '../completion.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue } from '#self';

/** https://tc39.es/ecma262/#sec-binary-logical-operators-runtime-semantics-evaluation */
//   CoalesceExpression :
//     CoalesceExpressionHead `??` BitwiseORExpression
export function* Evaluate_CoalesceExpression({ CoalesceExpressionHead, BitwiseORExpression }: ParseNode.CoalesceExpression): ValueEvaluator {
  // 1. Let lref be the result of evaluating |CoalesceExpressionHead|.
  const lref = Q(yield* Evaluate(CoalesceExpressionHead));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. If lval is *undefined* or *null*,
  if (lval === Value.undefined || lval === Value.null) {
    // a. Let rref be the result of evaluating |BitwiseORExpression|.
    const rref = Q(yield* Evaluate(BitwiseORExpression));
    // b. Return ? GetValue(rref).
    return Q(yield* GetValue(rref));
  }
  // 4. Otherwise, return lval.
  return lval;
}
