import { ObjectValue } from '../value.mts';
import { Q, X } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ArgumentListEvaluation } from './all.mts';
import {
  Assert,
  Construct,
  GetNewTarget,
  GetThisEnvironment,
  IsConstructor,
  InitializeInstanceElements,
  isECMAScriptFunctionObject,
  Throw,
  type FunctionObject,
} from '#self';
import { FunctionEnvironmentRecord } from '#self';

/** https://tc39.es/ecma262/#sec-super-keyword-runtime-semantics-evaluation */
// SuperCall : `super` Arguments
export function* Evaluate_SuperCall({ Arguments }: ParseNode.SuperCall) {
  // 1. Let newTarget be GetNewTarget().
  const newTarget = GetNewTarget();
  // 2. Assert: Type(newTarget) is Object.
  Assert(newTarget instanceof ObjectValue);
  // 3. Let func be ! GetSuperConstructor().
  const func = X(GetSuperConstructor());
  // 4. Let argList be ? ArgumentListEvaluation of Arguments.
  const argList = Q(yield* ArgumentListEvaluation(Arguments));
  // 5. If IsConstructor(func) is false, throw a TypeError exception.
  if (!IsConstructor(func)) {
    return Throw.TypeError('super ($1) is not a constructor', func);
  }
  // 6. Let result be ? Construct(func, argList, newTarget).
  const result = Q(yield* Construct(func, argList, newTarget as FunctionObject));
  // 7. Let thisER be GetThisEnvironment().
  const thisER = GetThisEnvironment();
  // 8. Assert: thisER is a Function Environment Record.
  Assert(thisER instanceof FunctionEnvironmentRecord);
  // 8. Perform ? thisER.BindThisValue(result).
  Q(thisER.BindThisValue(result));
  // 9. Let F be thisER.[[FunctionObject]].
  const F = thisER.FunctionObject;
  // 10. Assert: F is an ECMAScript function object.
  Assert(isECMAScriptFunctionObject(F));
  // 11. Perform ? InitializeInstanceElements(result, F).
  Q(yield* InitializeInstanceElements(result, F));
  // 12. Return result.
  return result;
}

/** https://tc39.es/ecma262/#sec-getsuperconstructor */
function GetSuperConstructor() {
  // 1. Let envRec be GetThisEnvironment().
  const envRec = GetThisEnvironment();
  // 2. Assert: envRec is a function Environment Record.
  Assert(envRec instanceof FunctionEnvironmentRecord);
  // 3. Let activeFunction be envRec.[[FunctionObject]].
  const activeFunction = envRec.FunctionObject;
  // 4. Assert: activeFunction is an ECMAScript function object.
  Assert(isECMAScriptFunctionObject(activeFunction));
  // 5. Let superConstructor be ! activeFunction.[[GetPrototypeOf]]().
  const superConstructor = X(activeFunction.GetPrototypeOf());
  // 6. Return superConstructor.
  return superConstructor;
}
