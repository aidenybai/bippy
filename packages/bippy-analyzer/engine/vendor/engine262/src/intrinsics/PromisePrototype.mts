import {
  ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import {
  Q, X,
} from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { PromiseObject } from './Promise.mts';
import { surroundingAgent } from '#self';
import {
  Assert,
  Call,
  CreateBuiltinFunction,
  Get,
  Invoke,
  IsCallable,
  IsConstructor,
  IsPromise,
  NewPromiseCapability,
  PerformPromiseThen,
  PromiseResolve,
  Realm,
  SpeciesConstructor,
  Throw,
  type FunctionObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-promise.prototype.catch */
function* PromiseProto_catch([onRejected = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let promise be the this value.
  const promise = thisValue;
  // 2. Return ? Invoke(promise, "then", « undefined, onRejected »).
  return Q(yield* Invoke(promise, 'then', [Value.undefined, onRejected]));
}

/** https://tc39.es/ecma262/#sec-promise.prototype.finally */
function* PromiseProto_finally([onFinally = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let promise be the this value.
  const promise = thisValue;
  // 2. If Type(promise) is not Object, throw a TypeError exception.
  if (!(promise instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', promise, 'Promise');
  }
  // 3. Let C be ? SpeciesConstructor(promise, %Promise%).
  const constructor = Q(yield* SpeciesConstructor(promise, surroundingAgent.intrinsic('%Promise%')));
  // 4. Assert: IsConstructor(C) is true.
  Assert(IsConstructor(constructor));
  let thenFinally;
  let catchFinally;
  // 5. If IsCallable(onFinally) is false, then
  if (!IsCallable(onFinally)) {
    // a. Let thenFinally be onFinally.
    thenFinally = onFinally;
    // b. Let catchFinally be onFinally.
    catchFinally = onFinally;
  } else { // 6. Else,
    // a. Let thenFinallyClosure be a new Abstract Closure with parameters (value) that captures onFinally and C and performs the following steps when called:
    const thenFinallyClosure = function* thenFinallyClosure([value = Value.undefined]: Arguments): ValueEvaluator {
      // i. Let result be ? Call(onFinally, undefined).
      const result = Q(yield* Call(onFinally, Value.undefined));
      // ii. Let promise be ? PromiseResolve(C, result).
      const promiseInner = Q(yield* PromiseResolve(constructor, result));
      // iii. Let returnValue be a new Abstract Closure with no parameters that captures value and performs the following steps when called:
      //   1. Return value.
      const returnValue = () => value;
      // iv. Let valueThunk be ! CreateBuiltinFunction(returnValue, 0, "", « »).
      const valueThunk = X(CreateBuiltinFunction(returnValue, 0, Value(''), []));
      // v. Return ? Invoke(promise, "then", « valueThunk »).
      return Q(yield* Invoke(promiseInner, 'then', [valueThunk]));
    };
    // b. Let thenFinally be ! CreateBuiltinFunction(thenFinallyClosure, 1, "", « »).
    thenFinally = X(CreateBuiltinFunction(thenFinallyClosure, 1, Value(''), ['HostCapturedValues']));
    // NON-SPEC
    thenFinally.HostCapturedValues = [onFinally];
    // c. Let catchFinallyClosure be a new Abstract Closure with parameters (reason) that captures onFinally and C and performs the following steps when called:
    const catchFinallyClosure = function* catchFinallyClosure([reason = Value.undefined]: Arguments): ValueEvaluator {
      // i. Let result be ? Call(onFinally, undefined).
      const result = Q(yield* Call(onFinally, Value.undefined));
      // ii. Let promise be ? PromiseResolve(C, result).
      const promiseInner = Q(yield* PromiseResolve(constructor, result));
      // iii. Let throwReason be a new Abstract Closure with no parameters that captures reason and performs the following steps when called:
      //   1. Return Throw(reason).
      const throwReason = () => Throw(reason);
      // iv. Let thrower be ! CreateBuiltinFunction(throwReason, 0, "", « »).
      const thrower = X(CreateBuiltinFunction(throwReason, 0, Value(''), []));
      // v. Return ? Invoke(promise, "then", « thrower »).
      return Q(yield* Invoke(promiseInner, 'then', [thrower]));
    };
    // d. Let catchFinally be ! CreateBuiltinFunction(catchFinallyClosure, 1, "", « »).
    catchFinally = X(CreateBuiltinFunction(catchFinallyClosure, 1, Value(''), ['HostCapturedValues']));
    // NON-SPEC
    catchFinally.HostCapturedValues = [onFinally];
  }
  // 7. Return ? Invoke(promise, "then", « thenFinally, catchFinally »).
  return Q(yield* Invoke(promise, 'then', [thenFinally, catchFinally]));
}

/** https://tc39.es/ecma262/#sec-promise.prototype.then */
function* PromiseProto_then([onFulfilled = Value.undefined, onRejected = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Let promise be the this value.
  const promise = thisValue as PromiseObject;
  // 2. If IsPromise(promise) is false, throw a TypeError exception.
  if (!IsPromise(promise)) {
    return Throw.TypeError('$1 is not a $2 object', promise, 'Promise');
  }
  // 3. Let C be ? SpeciesConstructor(promise, %Promise%).
  const constructor = Q(yield* SpeciesConstructor(promise, surroundingAgent.intrinsic('%Promise%')));
  // 4. Let resultCapability be ? NewPromiseCapability(C).
  const resultCapability = Q(yield* NewPromiseCapability(constructor));
  // 5. Return PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability).
  Q(surroundingAgent.debugger_tryTouchDuringPreview(promise));
  return PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability);
}

export function bootstrapPromisePrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['catch', PromiseProto_catch, 1],
    ['finally', PromiseProto_finally, 1],
    ['then', PromiseProto_then, 2],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Promise');

  realmRec.Intrinsics['%Promise.prototype.then%'] = X(Get(proto, 'then')) as FunctionObject;

  realmRec.Intrinsics['%Promise.prototype%'] = proto;
}
