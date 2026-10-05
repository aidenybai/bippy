import {
  Evaluate,
  type ValueEvaluator,
} from '../evaluator.mts';
import {
  Q,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  GetValue,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-throw-statement-runtime-semantics-evaluation */
// ThrowStatement : `throw` Expression `;`
export function* Evaluate_ThrowStatement({ Expression }: ParseNode.ThrowStatement): ValueEvaluator {
  // 1. Let exprRef be the result of evaluating Expression.
  const exprRef = Q(yield* Evaluate(Expression));
  // 2. Let exprValue be ? GetValue(exprRef).
  const exprValue = Q(yield* GetValue(exprRef));
  // 3. Throw exprValue.
  Throw(exprValue);
}
