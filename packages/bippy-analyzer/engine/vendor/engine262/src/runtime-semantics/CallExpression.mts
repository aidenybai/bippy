import { Value, ReferenceRecord, JSStringValue } from '../value.mts';
import { IsInTailPosition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EvaluateCall, ArgumentListEvaluation } from './all.mts';
import {
  surroundingAgent,
  GetValue,
  IsPropertyReference,
  PerformEval,
  SameValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-calls-runtime-semantics-evaluation */
// CallExpression :
//   CoverCallExpressionAndAsyncArrowHead
//   CallExpression Arguments
export function* Evaluate_CallExpression(CallExpression: ParseNode.CallExpression): ValueEvaluator {
  // 1. Let expr be CoveredCallExpression of CoverCallExpressionAndAsyncArrowHead.
  const expr = CallExpression;
  // 2. Let memberExpr be the MemberExpression of expr.
  const memberExpr = expr.CallExpression;
  // 3. Let arguments be the Arguments of expr.
  const args = expr.Arguments;
  // 4. Let ref be the result of evaluating memberExpr.
  const ref = Q(yield* Evaluate(memberExpr));
  // 5. Let func be ? GetValue(ref).
  const func = Q(yield* GetValue(ref));
  // 6. If Type(ref) is Reference, IsPropertyReference(ref) is false, and GetReferencedName(ref) is "eval", then
  if (ref instanceof ReferenceRecord
      && !IsPropertyReference(ref)
      && (ref.ReferencedName instanceof JSStringValue
      && ref.ReferencedName.stringValue() === 'eval')) {
    // a. If SameValue(func, %eval%) is true, then
    if (SameValue(func, surroundingAgent.intrinsic('%eval%'))) {
      // i. Let argList be ? ArgumentListEvaluation of arguments.
      const argList = Q(yield* ArgumentListEvaluation(args));
      // ii. If argList has no elements, return undefined.
      if (argList.length === 0) {
        return Value.undefined;
      }
      // iii. Let evalText be the first element of argList.
      const evalText = argList[0]!;
      // iv. If the source code matching this CallExpression is strict mode code, let strictCaller be true. Otherwise let strictCaller be false.
      const strictCaller = CallExpression.strict;
      // vi. Return ? PerformEval(evalText, strictCaller, true).
      return Q(yield* PerformEval(evalText, strictCaller, true));
    }
  }
  // 7. Let thisCall be this CallExpression.
  const thisCall = CallExpression;
  // 8. Let tailCall be IsInTailPosition(thisCall).
  const tailCall = IsInTailPosition(thisCall);
  // 9. Return ? EvaluateCall(func, ref, arguments, tailCall).
  return Q(yield* EvaluateCall(func, ref, args, tailCall, CallExpression));
}
