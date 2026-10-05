import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue } from '#self';

/** https://tc39.es/ecma262/#sec-expression-statement-runtime-semantics-evaluation */
//   ExpressionStatement :
//     Expression `;`
export function* Evaluate_ExpressionStatement({ Expression }: ParseNode.ExpressionStatement): ValueEvaluator {
  // 1. Let exprRef be the result of evaluating Expression.
  const exprRef = Q(yield* Evaluate(Expression));
  // 2. Return ? GetValue(exprRef).
  return Q(yield* GetValue(exprRef));
}
