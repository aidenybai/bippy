import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyStringOrNumericBinaryOperator, type BinaryOperator } from './all.mts';
import { GetValue } from '#self';

/** https://tc39.es/ecma262/#sec-evaluatestringornumericbinaryexpression */
export function* EvaluateStringOrNumericBinaryExpression(leftOperand: ParseNode.Expression, opText: BinaryOperator, rightOperand: ParseNode.Expression): ValueEvaluator {
  // 1. Let lref be the result of evaluating leftOperand.
  const lref = Q(yield* Evaluate(leftOperand));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating rightOperand.
  const rref = Q(yield* Evaluate(rightOperand));
  // 4. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  // 5. Return ? ApplyStringOrNumericBinaryOperator(lval, opText, rval).
  return Q(yield* ApplyStringOrNumericBinaryOperator(lval, opText, rval));
}
