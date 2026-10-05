import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ToBoolean, GetValue } from '#self';

/** https://tc39.es/ecma262/#sec-conditional-operator-runtime-semantics-evaluation */
//   ConditionalExpression :
//     ShortCircuitExpression `?` AssignmentExpression `:` AssignmentExpression
export function* Evaluate_ConditionalExpression({
  ShortCircuitExpression,
  AssignmentExpression_a,
  AssignmentExpression_b,
}: ParseNode.ConditionalExpression): ValueEvaluator {
  // 1. Let lref be the result of evaluating ShortCircuitExpression.
  const lref = Q(yield* Evaluate(ShortCircuitExpression));
  // 2. Let lval be ! ToBoolean(? GetValue(lref)).
  const lval = X(ToBoolean(Q(yield* GetValue(lref))));
  // 3. If lval is true, then
  if (lval) {
    // a. Let trueRef be the result of evaluating the first AssignmentExpression.
    const trueRef = Q(yield* Evaluate(AssignmentExpression_a));
    // b. Return ? GetValue(trueRef).
    return Q(yield* GetValue(trueRef));
  } else { // 4. Else,
    // a. Let falseRef be the result of evaluating the second AssignmentExpression.
    const falseRef = Q(yield* Evaluate(AssignmentExpression_b));
    // b. Return ? GetValue(falseRef).
    return Q(yield* GetValue(falseRef));
  }
}
