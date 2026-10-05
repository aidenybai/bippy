import { Q } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateStringOrNumericBinaryExpression } from './all.mts';

/** https://tc39.es/ecma262/#sec-left-shift-operator-runtime-semantics-evaluation */
//  ShiftExpression :
//    ShiftExpression `<<` AdditiveExpression
/** https://tc39.es/ecma262/#sec-signed-right-shift-operator-runtime-semantics-evaluation */
//  ShiftExpression :
//    ShiftExpression `>>` AdditiveExpression
/** https://tc39.es/ecma262/#sec-unsigned-right-shift-operator-runtime-semantics-evaluation */
//  ShiftExpression :
//    ShiftExpression `>>>` AdditiveExpression
export function* Evaluate_ShiftExpression({ ShiftExpression, operator, AdditiveExpression }: ParseNode.ShiftExpression): ValueEvaluator {
  return Q(yield* EvaluateStringOrNumericBinaryExpression(ShiftExpression, operator, AdditiveExpression));
}
