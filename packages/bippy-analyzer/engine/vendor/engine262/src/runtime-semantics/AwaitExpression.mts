import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Await, Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue, surroundingAgent } from '#self';

/** https://tc39.es/ecma262/#sec-async-function-definitions-runtime-semantics-evaluation */
//   AwaitExpression : `await` UnaryExpression
export function* Evaluate_AwaitExpression({ UnaryExpression }: ParseNode.AwaitExpression): ValueEvaluator {
  Q(surroundingAgent.debugger_cannotPreview);
  // 1. Let exprRef be the result of evaluating UnaryExpression.
  const exprRef = Q(yield* Evaluate(UnaryExpression));
  // 2. Let value be ? GetValue(exprRef).
  const value = Q(yield* GetValue(exprRef));
  // 3. Return ? Await(value).
  return Q(yield* Await(value));
}
