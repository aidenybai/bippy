import { Q } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateStringOrNumericBinaryExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-addition-operator-plus-runtime-semantics-evaluation */
//   AdditiveExpression : AdditiveExpression + MultiplicativeExpression
function* Evaluate_AdditiveExpression_Plus({ AdditiveExpression, MultiplicativeExpression }: ParseNode.AdditiveExpression): ValueEvaluator {
  // 1. Return ? EvaluateStringOrNumericBinaryExpression(AdditiveExpression, +, MultiplicativeExpression).
  return Q(yield* EvaluateStringOrNumericBinaryExpression(AdditiveExpression, '+', MultiplicativeExpression));
}

/** https://tc39.es/ecma262/#sec-subtraction-operator-minus-runtime-semantics-evaluation */
function* Evaluate_AdditiveExpression_Minus({ AdditiveExpression, MultiplicativeExpression }: ParseNode.AdditiveExpression): ValueEvaluator {
  // 1. Return ? EvaluateStringOrNumericBinaryExpression(AdditiveExpression, -, MultiplicativeExpression).
  return Q(yield* EvaluateStringOrNumericBinaryExpression(AdditiveExpression, '-', MultiplicativeExpression));
}

export function* Evaluate_AdditiveExpression(AdditiveExpression: ParseNode.AdditiveExpression) {
  switch (AdditiveExpression.operator) {
    case '+':
      return yield* Evaluate_AdditiveExpression_Plus(AdditiveExpression);
    case '-':
      return yield* Evaluate_AdditiveExpression_Minus(AdditiveExpression);
    default:
      throw OutOfRange.nonExhaustive(AdditiveExpression);
  }
}
