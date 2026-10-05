import { UndefinedValue, Value, wellKnownSymbols } from '../value.mts';
import { IfAbruptRejectPromise, X } from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  Call,
  CreateBuiltinFunction,
  GetMethod,
  intrinsics,
  NewPromiseCapability,
  PerformPromiseThen,
  PromiseResolve,
  type Arguments,
  type FunctionCallContext,
  type FunctionObject,
  type PromiseObject,
  type Realm,
} from '#self';

/** https://tc39.es/ecma262/#sec-%asynciteratorprototype%-%symbol.asyncdispose% */
function* AsyncIteratorPrototype_asyncDispose(_args: Arguments, { thisValue }: FunctionCallContext) {
  const obj = thisValue;
  const promiseCapability = X(NewPromiseCapability(intrinsics()['%Promise%']));
  const returnMethod = yield* GetMethod(obj, 'return');
  IfAbruptRejectPromise(returnMethod, promiseCapability);
  __ts_cast__<UndefinedValue | FunctionObject>(returnMethod);
  if (returnMethod instanceof UndefinedValue) {
    X(Call(promiseCapability.Resolve, Value.undefined, [Value.undefined]));
  } else {
    const result = yield* Call(returnMethod, thisValue, []);
    IfAbruptRejectPromise(result, promiseCapability);
    __ts_cast__<Value>(result);
    const resultWrapper = yield* PromiseResolve(intrinsics()['%Promise%'], result);
    IfAbruptRejectPromise(resultWrapper, promiseCapability);
    __ts_cast__<PromiseObject>(resultWrapper);
    const unwrap = () => Value.undefined;
    const onFulfilled = CreateBuiltinFunction(unwrap, 1, Value(''), []);
    PerformPromiseThen(resultWrapper, onFulfilled, Value.undefined, promiseCapability);
  }
  return promiseCapability.Promise;
}

/** https://tc39.es/ecma262/#sec-asynciteratorprototype-asynciterator */
function AsyncIteratorPrototype_asyncIterator(_args: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Return the this value.
  return thisValue;
}

export function bootstrapAsyncIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    [wellKnownSymbols.asyncDispose, AsyncIteratorPrototype_asyncDispose, 0],
    [wellKnownSymbols.asyncIterator, AsyncIteratorPrototype_asyncIterator, 0],
  ], realmRec.Intrinsics['%Object.prototype%']);

  realmRec.Intrinsics['%AsyncIteratorPrototype%'] = proto;
}
