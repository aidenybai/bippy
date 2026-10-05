import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { isArray } from '../utils/language.mts';
import { ArgumentListEvaluation } from './all.mts';
import {
  Assert,
  Construct,
  GetValue,
  IsConstructor,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-evaluatenew */
function* EvaluateNew(constructExpr: ParseNode.LeftHandSideExpression, args: undefined | ParseNode.Arguments) {
  // 1. Assert: constructExpr is either a NewExpression or a MemberExpression.
  // 2. Assert: arguments is either empty or an Arguments.
  Assert(args === undefined || isArray(args));
  // 3. Let ref be the result of evaluating constructExpr.
  const ref = Q(yield* Evaluate(constructExpr));
  // 4. Let constructor be ? GetValue(ref).
  const constructor = Q(yield* GetValue(ref));
  let argList;
  // 5. If arguments is empty, let argList be a new empty List.
  if (args === undefined) {
    argList = [];
  } else { // 6. Else,
    // a. Let argList be ? ArgumentListEvaluation of arguments.
    argList = Q(yield* ArgumentListEvaluation(args));
  }
  // 7. If IsConstructor(constructor) is false, throw a TypeError exception.
  if (!IsConstructor(constructor)) {
    return Throw.TypeError('$1 is not a constructor', constructor);
  }
  // 8. Return ? Construct(constructor, argList).
  return Q(yield* Construct(constructor, argList));
}

/** https://tc39.es/ecma262/#sec-new-operator-runtime-semantics-evaluation */
//   NewExpression :
//     `new` NewExpression
//     `new` MemberExpression Arguments
export function* Evaluate_NewExpression({ MemberExpression, Arguments }: ParseNode.NewExpression): ValueEvaluator {
  if (!Arguments) {
    // 1. Return ? EvaluateNew(NewExpression, empty).
    return Q(yield* EvaluateNew(MemberExpression, undefined));
  } else {
    // 1. Return ? EvaluateNew(MemberExpression, Arguments).
    return Q(yield* EvaluateNew(MemberExpression, Arguments));
  }
}
