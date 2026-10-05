import {
  ObjectValue, Value, ReferenceRecord,
} from '../value.mts';
import { Q, Completion, AbruptCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ArgumentListEvaluation } from './all.mts';
import {
  Assert,
  IsPropertyReference,
  IsCallable,
  GetThisValue,
  PerformTailCall,
  Call,
  EnvironmentRecord,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-evaluatecall */
export function* EvaluateCall(func: Value, ref: ReferenceRecord | Value, args: ParseNode.TemplateLiteral | ParseNode.Arguments, tailPosition: boolean, callExpression?: ParseNode.CallExpression | ParseNode.OptionalExpression) {
  // 1. If Type(ref) is Reference, then
  let thisValue;
  if (ref instanceof ReferenceRecord) {
    // a. If IsPropertyReference(ref) is true, then
    if (IsPropertyReference(ref)) {
      // i. Let thisValue be GetThisValue(ref).
      thisValue = GetThisValue(ref);
    } else {
      // i. Let refEnv be ref.[[Base]].
      const refEnv = ref.Base;
      // ii. Assert: refEnv is an Environment Record.
      Assert(refEnv instanceof EnvironmentRecord);
      // iii. Let thisValue be refEnv.WithBaseObject().
      thisValue = refEnv.WithBaseObject();
    }
  } else {
    // a. Let thisValue be undefined.
    thisValue = Value.undefined;
  }
  // 3. Let argList be ? ArgumentListEvaluation of arguments.
  const argList = Q(yield* ArgumentListEvaluation(args));
  // 4. If Type(func) is not Object, throw a TypeError exception.
  // 5. If IsCallable(func) is false, throw a TypeError exception.
  if (!(func instanceof ObjectValue) || !IsCallable(func)) {
    if (callExpression) {
      const source = callExpression.sourceText;
      const arg0StartIndex = args.location.startIndex;
      if (source.length < 100) {
        return Throw.TypeError('$1 is not a function. (In "$2", it is $3)', source.slice(0, arg0StartIndex - callExpression.location.startIndex), source, func);
      }
    }
    return Throw.TypeError('$1 is not a function', func);
  }
  // 6. If tailPosition is true, perform PrepareForTailCall().
  if (tailPosition) {
    return yield* PerformTailCall(func, thisValue, argList);
  }
  // 7. Let result be Call(func, thisValue, argList).
  const result = yield* Call(func, thisValue, argList);
  // 8. Assert: If tailPosition is true, the above call will not return here but instead
  //    evaluation will continue as if the following return has already occurred.
  // 9. Assert: If result is not an abrupt completion, then Type(result) is an ECMAScript language type.
  if (!(result instanceof AbruptCompletion)) {
    Assert(result instanceof Value || result instanceof Completion);
  }
  // 10. Return result.
  return result;
}
