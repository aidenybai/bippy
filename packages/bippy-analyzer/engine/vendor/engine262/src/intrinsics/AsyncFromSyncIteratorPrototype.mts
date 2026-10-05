import {
  ObjectValue, UndefinedValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import {
  IfAbruptRejectPromise, NormalCompletion, X,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  AsyncFromSyncIteratorContinuation,
  Call,
  CreateIteratorResultObject,
  GetMethod,
  IteratorNext,
  NewPromiseCapability,
  Assert,
  type OrdinaryObject,
  type IteratorRecord,
  IteratorClose,
  type FunctionObject,
  Realm,
  Throw,
} from '#self';

export interface AsyncFromSyncIteratorObject extends OrdinaryObject {
  readonly SyncIteratorRecord: IteratorRecord;
}
/** https://tc39.es/ecma262/#sec-%asyncfromsynciteratorprototype%.next */
function* AsyncFromSyncIteratorPrototype_next([value]: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Let O be the this value.
  const O = thisValue as AsyncFromSyncIteratorObject;
  // 2. Assert: Type(O) is Object and O has a [[SyncIteratorRecord]] internal slot.
  Assert(O instanceof ObjectValue && 'SyncIteratorRecord' in O);
  // 3. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 4. Let syncIteratorRecord be O.[[SyncIteratorRecord]].
  const syncIteratorRecord = O.SyncIteratorRecord;
  // 5. If value is present, then
  let result;
  if (value !== undefined) {
    // a. Let result be IteratorNext(syncIteratorRecord, value).
    result = yield* IteratorNext(syncIteratorRecord, value);
  } else { // 6. Else,
    // a. Let result be IteratorNext(syncIteratorRecord).
    result = yield* IteratorNext(syncIteratorRecord);
  }
  // 7. IfAbruptRejectPromise(result, promiseCapability).
  IfAbruptRejectPromise(result, promiseCapability);
  __ts_cast__<ObjectValue>(result);
  // 8. Return ! AsyncFromSyncIteratorContinuation(result, promiseCapability, syncIteratorRecord, true).
  return X(AsyncFromSyncIteratorContinuation(result, promiseCapability, syncIteratorRecord, true));
}

/** https://tc39.es/ecma262/#sec-%asyncfromsynciteratorprototype%.return */
function* AsyncFromSyncIteratorPrototype_return([value]: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Let O be the this value.
  const O = thisValue as AsyncFromSyncIteratorObject;
  // 2. Assert: Type(O) is Object and O has a [[SyncIteratorRecord]] internal slot.
  Assert(O instanceof ObjectValue && 'SyncIteratorRecord' in O);
  // 3. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 4. Let syncIterator be O.[[SyncIteratorRecord]].[[Iterator]].
  const syncIteratorRecord = O.SyncIteratorRecord;
  const syncIterator = syncIteratorRecord.Iterator;
  // 5. Let return be GetMethod(syncIterator, "return").
  const ret = yield* GetMethod(syncIterator, 'return');
  // 6. IfAbruptRejectPromise(return, promiseCapability).
  IfAbruptRejectPromise(ret, promiseCapability);
  __ts_cast__<UndefinedValue | FunctionObject>(ret);
  // 7. If return is undefined, then
  if (ret === Value.undefined) {
    // a. Let iteratorResult be CreateIteratorResultObject(value, true).
    const iteratorResult = CreateIteratorResultObject(value || Value.undefined, true);
    // b. Perform ! Call(promiseCapability.[[Resolve]], undefined, « iteratorResult »).
    X(Call(promiseCapability.Resolve, Value.undefined, [iteratorResult]));
    // c. Return promiseCapability.[[Promise]].
    return promiseCapability.Promise;
  }
  // 8. If value is present, then
  let result;
  if (value !== undefined) {
    // a. Let result be Call(return, syncIterator, « value »).
    result = yield* Call(ret, syncIterator, [value]);
  } else { // 9. Else,
    // a. Let result be Call(return, syncIterator).
    result = yield* Call(ret, syncIterator);
  }
  // 10. IfAbruptRejectPromise(result, promiseCapability).
  IfAbruptRejectPromise(result, promiseCapability);
  __ts_cast__<Value>(result);
  // 11. If result is not an Object, then
  if (!(result instanceof ObjectValue)) {
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « a newly created TypeError object »).
    X(Call(promiseCapability.Reject, Value.undefined, [
      Throw.TypeError('$1 is not an object', result).Value,
    ]));
    // b. Return promiseCapability.[[Promise]].
    return promiseCapability.Promise;
  }
  // 12. Return ! AsyncFromSyncIteratorContinuation(result, promiseCapability, syncIteratorRecord, false).
  return X(AsyncFromSyncIteratorContinuation(result, promiseCapability, syncIteratorRecord, false));
}

/** https://tc39.es/ecma262/#sec-%asyncfromsynciteratorprototype%.throw */
function* AsyncFromSyncIteratorPrototype_throw([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Let O be this value.
  const O = thisValue as AsyncFromSyncIteratorObject;
  // 2. Assert: Type(O) is Object and O has a [[SyncIteratorRecord]] internal slot.
  Assert(O instanceof ObjectValue && 'SyncIteratorRecord' in O);
  // 3. Let promiseCapability be ! NewPromiseCapability(%Promise%).
  const promiseCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 4. Let syncIterator be O.[[SyncIteratorRecord]].[[Iterator]].
  const syncIteratorRecord = O.SyncIteratorRecord;
  const syncIterator = syncIteratorRecord.Iterator;
  // 5. Let throw be GetMethod(syncIterator, "throw").
  const thr = yield* GetMethod(syncIterator, 'throw');
  // 6. IfAbruptRejectPromise(throw, promiseCapability).
  IfAbruptRejectPromise(thr, promiseCapability);
  __ts_cast__<UndefinedValue | FunctionObject>(thr);
  // 7. If throw is undefined, then
  if (thr === Value.undefined) {
    const closeCompletion = NormalCompletion(undefined);
    const result = yield* IteratorClose(syncIteratorRecord, closeCompletion);
    IfAbruptRejectPromise(result, promiseCapability);
    X(Call(promiseCapability.Reject, Value.undefined, [
      // TODO: error message should be no throw method
      Throw.TypeError('$1 is not an object', value).Value,
    ]));
    return promiseCapability.Promise;
  }
  // 8. If value is present, then
  let result;
  if (value !== undefined) {
    // a. Let result be Call(throw, syncIterator, « value »).
    result = yield* Call(thr, syncIterator, [value]);
  } else { // 9. Else,
    // a. Let result be Call(throw, syncIterator).
    result = yield* Call(thr, syncIterator);
  }
  // 10. IfAbruptRejectPromise(result, promiseCapability).
  IfAbruptRejectPromise(result, promiseCapability);
  __ts_cast__<Value>(result);
  // 11. If Type(result) is not Object, then
  if (!(result instanceof ObjectValue)) {
    // a. Perform ! Call(promiseCapability.[[Reject]], undefined, « a newly created TypeError object »).
    X(Call(promiseCapability.Reject, Value.undefined, [
      Throw.TypeError('$1 is not an object', result).Value,
    ]));
    // b. Return promiseCapability.[[Promise]].
    return promiseCapability.Promise;
  }
  // 12. Return ! AsyncFromSyncIteratorContinuation(result, promiseCapability, syncIteratorRecord, true).
  return X(AsyncFromSyncIteratorContinuation(result, promiseCapability, syncIteratorRecord, true));
}

export function bootstrapAsyncFromSyncIteratorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['next', AsyncFromSyncIteratorPrototype_next, 0],
    ['return', AsyncFromSyncIteratorPrototype_return, 0],
    ['throw', AsyncFromSyncIteratorPrototype_throw, 0],
  ], realmRec.Intrinsics['%AsyncIteratorPrototype%']);

  realmRec.Intrinsics['%AsyncFromSyncIteratorPrototype%'] = proto;
}
