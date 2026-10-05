import { Value } from '../value.mts';
import { Evaluate, type Evaluator } from '../evaluator.mts';
import {
  Completion,
  Await,
  Q, X,
  ReturnCompletion,
  ThrowCompletion,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetValue, GetGeneratorKind } from '#self';

/** https://tc39.es/ecma262/#sec-return-statement-runtime-semantics-evaluation */
//  ReturnStatement :
//    `return` `;`
//    `return` Expression `;`
export function* Evaluate_ReturnStatement({ Expression }: ParseNode.ReturnStatement): Evaluator<ReturnCompletion | ThrowCompletion> {
  if (!Expression) {
    // 1. Return Completion { [[Type]]: return, [[Value]]: undefined, [[Target]]: empty }.
    return new Completion({ Type: 'return', Value: Value.undefined, Target: undefined });
  }
  // 1. Let exprRef be the result of evaluating Expression.
  const exprRef = Q(yield* Evaluate(Expression));
  // 1. Let exprValue be ? GetValue(exprRef).
  let exprValue = Q(yield* GetValue(exprRef));
  // 1. If ! GetGeneratorKind() is async, set exprValue to ? Await(exprValue).
  if (X(GetGeneratorKind()) === 'async') {
    exprValue = Q(yield* Await(exprValue));
  }
  // 1. Return Completion { [[Type]]: return, [[Value]]: exprValue, [[Target]]: empty }.
  return new Completion({ Type: 'return', Value: exprValue, Target: undefined });
}
