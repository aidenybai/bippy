import { Q } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateStringOrNumericBinaryExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-multiplicative-operators-runtime-semantics-evaluation */
//   MultiplicativeExpression :
//     MultiplicativeExpression MultiplicativeOperator ExponentiationExpression
export function* Evaluate_MultiplicativeExpression({
  MultiplicativeExpression,
  MultiplicativeOperator,
  ExponentiationExpression,
}: ParseNode.MultiplicativeExpression): ValueEvaluator {
  // 1. Let opText be the source text matched by MultiplicativeOperator.
  const opText = MultiplicativeOperator;
  // 2. Return ? EvaluateStringOrNumericBinaryExpression(MultiplicativeExpression, opText, ExponentiationExpression).
  return Q(yield* EvaluateStringOrNumericBinaryExpression(MultiplicativeExpression, opText, ExponentiationExpression));
}
