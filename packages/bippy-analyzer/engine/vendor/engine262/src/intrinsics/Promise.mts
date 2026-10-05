import {
  Descriptor,
  ObjectValue,
  UndefinedValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  AbruptCompletion,
  IfAbruptRejectPromise,
  EnsureCompletion,
  Q, X,
  type ValueEvaluator,
  type ValueCompletion,
} from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  surroundingAgent,
} from '#self';
import {
  Assert,
  Call,
  CreateArrayFromList,
  CreateBuiltinFunction,
  CreateDataProperty,
  CreateDataPropertyOrThrow,
  CreateResolvingFunctions,
  DefinePropertyOrThrow,
  Get,
  GetIterator,
  Invoke,
  IsCallable,
  IsConstructor,
  IteratorClose,
  NewPromiseCapability,
  OrdinaryObjectCreate,
  OrdinaryCreateFromConstructor,
  PromiseCapabilityRecord,
  PromiseResolve,
  PromiseReactionRecord,
  type PropertyKeyValue,
  type FunctionObject,
  Realm,
  Throw,
  type IteratorRecord,
  type OrdinaryObject,
  type PromiseAllResolveElementFunctionObject,
  type PromiseAllRejectElementFunctionObject,
  IteratorStepValue,
  PerformPromiseThen,
} from '#self';


/** https://tc39.es/ecma262/#table-internal-slots-of-promise-instances */
export interface PromiseObject extends OrdinaryObject {
  PromiseState: 'pending' | 'fulfilled' | 'rejected';
  PromiseResult: Value | undefined;
  PromiseFulfillReactions: undefined | PromiseReactionRecord[];
  PromiseRejectReactions: undefined | PromiseReactionRecord[];
  PromiseIsHandled: boolean;
}

export function isPromiseObject(value: Value): value is PromiseObject {
  return 'PromiseState' in value;
}

/** https://tc39.es/ecma262/#sec-promise-executor */
function* PromiseConstructor(this: FunctionObject, [executor = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  // 1. If NewTarget is undefined, throw a TypeError exception.
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('Promise cannot be invoked without new');
  }
  // 2. If IsCallable(executor) is false, throw a TypeError exception.
  if (!IsCallable(executor)) {
    return Throw.TypeError('$1 is not a function', executor);
  }
  // 3. Let promise be ? OrdinaryCreateFromConstructor(NewTarget, "%Promise.prototype%", « [[PromiseState]], [[PromiseResult]], [[PromiseFulfillReactions]], [[PromiseRejectReactions]], [[PromiseIsHandled]] »).
  const promise = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Promise.prototype%', [
    'PromiseState',
    'PromiseResult',
    'PromiseFulfillReactions',
    'PromiseRejectReactions',
    'PromiseIsHandled',
  ])) as Mutable<PromiseObject>;
  // 4. Set promise.[[PromiseState]] to pending.
  promise.PromiseState = 'pending';
  // 5. Set promise.[[PromiseFulfillReactions]] to a new empty List.
  promise.PromiseFulfillReactions = [];
  // 6. Set promise.[[PromiseFulfillReactions]] to a new empty List.
  promise.PromiseRejectReactions = [];
  // 7. Set promise.[[PromiseIsHandled]] to false.
  promise.PromiseIsHandled = false;
  // 8. Let resolvingFunctions be CreateResolvingFunctions(promise).
  const resolvingFunctions = CreateResolvingFunctions(promise);
  // 9. Let completion be Call(executor, undefined, « resolvingFunctions.[[Resolve]], resolvingFunctions.[[Reject]] »).
  const completion = yield* Call(executor, Value.undefined, [
    resolvingFunctions.Resolve, resolvingFunctions.Reject,
  ]);
  // 10. If completion is an abrupt completion, then
  if (completion instanceof AbruptCompletion) {
    // a. Perform ? Call(resolvingFunctions.[[Reject]], undefined, « completion.[[Value]] »).
    Q(yield* Call(resolvingFunctions.Reject, Value.undefined, [completion.Value]));
  }
  // 11. Return promise.
  return promise;
}

/** https://tc39.es/ecma262/#sec-getpromiseresolve */
function* GetPromiseResolve(promiseConstructor: FunctionObject) {
  // 1. Assert: IsConstructor(promiseConstructor) is true.
  Assert(IsConstructor(promiseConstructor));
  // 2. Let promiseResolve be ? Get(promiseConstructor, "resolve").
  const promiseResolve = Q(yield* Get(promiseConstructor, 'resolve'));
  // 3. If IsCallable(promiseResolve) is false, throw a TypeError exception.
  if (!IsCallable(promiseResolve)) {
    return Throw.TypeError('$1 is not a function', promiseResolve);
  }
  // 4. Return promiseResolve.
  return promiseResolve;
}

function CreatePromiseAllResolveElement(index: number, values: Value[], resultCapability: PromiseCapabilityRecord, remainingElementsCount: { Value: number }): FunctionObject {
  const fulfilledSteps = function* fulfilled([value = Value.undefined]: Arguments): ValueEvaluator {
    const F = surroundingAgent.activeFunctionObject as PromiseAllResolveElementFunctionObject;
    if (F.AlreadyCalled.Value) return Value.undefined;
    F.AlreadyCalled.Value = true;
    const thisIndex = F.Index;
    values[thisIndex] = value;
    remainingElementsCount.Value -= 1;
    if (remainingElementsCount.Value === 0) {
      const valuesArray = CreateArrayFromList(values);
      return Q(yield* Call(resultCapability.Resolve, Value.undefined, [valuesArray]));
    }
    return Value.undefined;
  };
  const onFulfilled = CreateBuiltinFunction(fulfilledSteps, 1, '', ['AlreadyCalled', 'Index']) as Mutable<PromiseAllResolveElementFunctionObject>;
  onFulfilled.AlreadyCalled = { Value: false };
  onFulfilled.Index = index;
  return onFulfilled;
}

/** https://tc39.es/ecma262/#sec-performpromiseall */
export function* PerformPromiseAll(iteratorRecord: IteratorRecord, constructor: FunctionObject, resultCapability: PromiseCapabilityRecord, promiseResolve: FunctionObject): ValueEvaluator {
  // 1. Assert: IsConstructor(constructor) is true.
  Assert(IsConstructor(constructor));
  // 2. Assert: resultCapability is a PromiseCapability Record.
  Assert(resultCapability instanceof PromiseCapabilityRecord);
  // 3. Assert: IsCallable(promiseResolve) is true.
  Assert(IsCallable(promiseResolve));
  // 4. Let values be a new empty List.
  const values: Value[] = [];
  // 5. Let remainingElementsCount be the Record { [[Value]]: 1 }.
  const remainingElementsCount = { Value: 1 };
  // 6. Let index be 0.
  let index = 0;
  // 7. Repeat,
  while (true) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // d. If next is done, then
    if (next === 'done') {
      // ii. Set remainingElementsCount.[[Value]] to remainingElementsCount.[[Value]] - 1.
      remainingElementsCount.Value -= 1;
      // iii. If remainingElementsCount.[[Value]] is 0, then
      if (remainingElementsCount.Value === 0) {
        // 1. Let valuesArray be ! CreateArrayFromList(values).
        const valuesArray = CreateArrayFromList(values);
        // 2. Perform ? Call(resultCapability.[[Resolve]], undefined, « valuesArray »).
        Q(yield* Call(resultCapability.Resolve, Value.undefined, [valuesArray]));
      }
      // iv. Return resultCapability.[[Promise]].
      return resultCapability.Promise;
    }
    // h. Append undefined to values.
    values.push(Value.undefined);
    // i. Let nextPromise be ? Call(promiseResolve, constructor, « next »).
    const nextPromise = Q(yield* Call(promiseResolve, constructor, [next]));
    const onFulfilled = CreatePromiseAllResolveElement(index, values, resultCapability, remainingElementsCount);
    index += 1;
    remainingElementsCount.Value += 1;
    Q(yield* Invoke(nextPromise, 'then', [onFulfilled, resultCapability.Reject]));
  }
}

/** https://tc39.es/proposal-defer-import-eval/#sec-getmodulenamespace */
export function SafePerformPromiseAll(promises: readonly PromiseObject[]) {
  const resultCapability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  if (!promises.length) {
    X(Call(resultCapability.Resolve, Value.undefined, [CreateArrayFromList([])]));
    return resultCapability.Promise;
  }
  const values: Value[] = [];
  const remainingElementsCount = { Value: promises.length };
  let index = 0;
  for (const promise of promises) {
    values.push(Value.undefined);
    const onFulfilled = CreatePromiseAllResolveElement(index, values, resultCapability, remainingElementsCount);
    index += 1;
    PerformPromiseThen(promise, onFulfilled, resultCapability.Reject);
  }
  return resultCapability.Promise;
}

/** https://tc39.es/ecma262/#sec-promise.all */
function* Promise_all([iterable = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be the this value.
  const constructor = thisValue;
  // 2. Let promiseCapability be ? NewPromiseCapability(C).
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  __ts_cast__<FunctionObject>(constructor);
  // 3. Let promiseResolve be GetPromiseResolve(C).
  const promiseResolve = yield* GetPromiseResolve(constructor);
  // 4. IfAbruptRejectPromise(promiseResolve, promiseCapability).
  IfAbruptRejectPromise(promiseResolve, promiseCapability);
  __ts_cast__<FunctionObject>(promiseResolve);
  // 5. Let iteratorRecord be GetIterator(iterable).
  const iteratorRecord = yield* GetIterator(iterable, 'sync');
  // 6. IfAbruptRejectPromise(iteratorRecord, promiseCapability).
  IfAbruptRejectPromise(iteratorRecord, promiseCapability);
  __ts_cast__<IteratorRecord>(iteratorRecord);
  // 7. Let result be PerformPromiseAll(iteratorRecord, C, promiseCapability, promiseResolve).
  let result: ValueCompletion = yield* PerformPromiseAll(iteratorRecord, constructor, promiseCapability, promiseResolve);
  // 8. If result is an abrupt completion, then
  if (result instanceof AbruptCompletion) {
    // a. If iteratorRecord.[[Done]] is false, set result to IteratorClose(iteratorRecord, result).
    if (!iteratorRecord.Done) {
      result = yield* IteratorClose(iteratorRecord, result);
    }
    // b. IfAbruptRejectPromise(result, promiseCapability).
    IfAbruptRejectPromise(result, promiseCapability);
  }
  // 9. Return ? result.
  return result;
}

/** https://tc39.es/proposal-await-dictionary/#sec-promise.allkeyed */
function* Promise_allKeyed([promises = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const constructor = thisValue;
  // 2. Let promiseCapability be ? NewPromiseCapability(C).
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  __ts_cast__<FunctionObject>(constructor);

  // 3. Let promiseResolve be Completion(GetPromiseResolve(C)).
  const promiseResolve = EnsureCompletion(yield* GetPromiseResolve(constructor));
  IfAbruptRejectPromise(promiseResolve, promiseCapability);
  __ts_cast__<FunctionObject>(promiseResolve);

  // 5. If promises is not an Object, then
  if (!(promises instanceof ObjectValue)) {
    // a. Let error be a newly created TypeError object.
    const error = Throw.TypeError('$1 is not an object', promises).Value;
    // b. Perform ? Call(promiseCapability.[[Reject]], undefined, « error »).
    Q(yield* Call(promiseCapability.Reject, Value.undefined, [error]));
    return promiseCapability.Promise;
  }

  // 6. Let result be Completion(PerformPromiseAllKeyed(all, promises, C, promiseCapability, promiseResolve)).
  const result = EnsureCompletion(yield* PerformPromiseAllKeyed('all', promises, constructor, promiseCapability, promiseResolve));
  IfAbruptRejectPromise(result, promiseCapability);
  return promiseCapability.Promise;
}

/** https://tc39.es/proposal-await-dictionary/#sec-performpromiseallkeyed */
interface KeyedPromiseCombinatorEntry {
  readonly Key: PropertyKeyValue;
  Value: Value;
}

/** https://tc39.es/proposal-await-dictionary/#sec-performpromiseallkeyed */
function* PerformPromiseAllKeyed(variant: 'all' | 'all-settled', promises: ObjectValue, constructor: FunctionObject, resultCapability: PromiseCapabilityRecord, promiseResolve: FunctionObject): ValueEvaluator {
  const allKeys: PropertyKeyValue[] = Q(yield* promises.OwnPropertyKeys());
  const entries: KeyedPromiseCombinatorEntry[] = [];
  const remainingElementsCount = { Value: 1 };
  let index: number = 0;

  // 6. For each element key of allKeys, do
  for (const key of allKeys) {
    // a. Let desc be ? promises.[[GetOwnProperty]](key).
    const desc = Q(yield* promises.GetOwnProperty(key));
    if (desc && desc.Enumerable) {
      // i. Let value be ? Get(promises, key).
      const value = Q(yield* Get(promises, key));

      entries.push({ Key: key, Value: Value.undefined });

      // iv. Let nextPromise be ? Call(promiseResolve, constructor, « value »).
      const nextPromise = Q(yield* Call(promiseResolve, constructor, [value]));
      const alreadyCalled = { Value: false };


      const onFulfilledSteps = function* onFulfilledSteps([value = Value.undefined]: Arguments): ValueEvaluator {
        const F = surroundingAgent.activeFunctionObject as PromiseAllResolveElementFunctionObject;
        if (F.AlreadyCalled.Value === true) {
          return Value.undefined;
        }
        F.AlreadyCalled.Value = true;

        const thisIndex: number = F.Index;
        if (variant === 'all') {
          entries[thisIndex].Value = value;
        } else {
          Assert(variant === 'all-settled');
          const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
          // c. Perform ! CreateDataPropertyOrThrow(obj, "status", "fulfilled").
          X(CreateDataProperty(obj, 'status', Value('fulfilled')));
          // d. Perform ! CreateDataPropertyOrThrow(obj, "value", x).
          X(CreateDataProperty(obj, 'value', value));
          entries[thisIndex].Value = obj;
        }

        remainingElementsCount.Value -= 1;
        if (remainingElementsCount.Value === 0) {
          const result: ObjectValue = CreateKeyedPromiseCombinatorResultObject(entries);
          // b. Return ? Call(resultCapability.[[Resolve]], undefined, « result »).
          return Q(yield* Call(resultCapability.Resolve, Value.undefined, [result]));
        }

        return Value.undefined;
      };

      // vii. Let onFulfilled be CreateBuiltinFunction(onFulfilledSteps, 1, "", « [[AlreadyCalled]], [[Index]] »).
      const onFulfilled = CreateBuiltinFunction(onFulfilledSteps, 1, Value(''), ['AlreadyCalled', 'Index']) as Mutable<PromiseAllResolveElementFunctionObject>;
      onFulfilled.AlreadyCalled = alreadyCalled;
      onFulfilled.Index = index;

      let onRejected: Value;
      // viii. If variant is all, then
      if (variant === 'all') {
        onRejected = resultCapability.Reject;
      } else {
        Assert(variant === 'all-settled');
        const onRejectedSteps = function* onRejectedSteps([error = Value.undefined]: Arguments): ValueEvaluator {
          const F = surroundingAgent.activeFunctionObject as PromiseAllRejectElementFunctionObject;

          if (F.AlreadyCalled.Value === true) {
            return Value.undefined;
          }
          F.AlreadyCalled.Value = true;

          const thisIndex: number = F.Index;
          const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
          // d. Perform ! CreateDataPropertyOrThrow(obj, "status", "rejected").
          X(CreateDataProperty(obj, 'status', Value('rejected')));
          // e. Perform ! CreateDataPropertyOrThrow(obj, "reason", x).
          X(CreateDataProperty(obj, 'reason', error));

          entries[thisIndex].Value = obj;

          remainingElementsCount.Value -= 1;
          if (remainingElementsCount.Value === 0) {
            // i. Let result be CreateKeyedPromiseCombinatorResultObject(entries).
            const result: ObjectValue = CreateKeyedPromiseCombinatorResultObject(entries);
            // ii. Return ? Call(resultCapability.[[Resolve]], undefined, « result »).
            return Q(yield* Call(resultCapability.Resolve, Value.undefined, [result]));
          }

          return Value.undefined;
        };

        const onRejectNative = CreateBuiltinFunction(onRejectedSteps, 1, Value(''), ['AlreadyCalled', 'Index']) as Mutable<PromiseAllRejectElementFunctionObject>;
        onRejectNative.AlreadyCalled = alreadyCalled;
        onRejectNative.Index = index;
        onRejected = onRejectNative;
      }

      remainingElementsCount.Value += 1;
      // xi. Perform ? Invoke(nextPromise, "then", « onFulfilled, onRejected »).
      Q(yield* Invoke(nextPromise, 'then', [onFulfilled, onRejected]));
      index += 1;
    }
  }

  remainingElementsCount.Value -= 1;

  if (remainingElementsCount.Value === 0) {
    /*
    a. NOTE: This can happen even if entries was non-empty if an ill-behaved thenable synchronously invoked the callback passed to its "then" method.
    b. Let result be CreateKeyedPromiseCombinatorResultObject(entries).
    */
    const result = CreateKeyedPromiseCombinatorResultObject(entries);
    // c. Perform ? Call(resultCapability.[[Resolve]], undefined, « result »).
    Q(yield* Call(resultCapability.Resolve, Value.undefined, [result]));
  }

  return resultCapability.Promise;
}

/** https://tc39.es/proposal-await-dictionary/#sec-createkeyedpromisecombinatorresultobject */
function CreateKeyedPromiseCombinatorResultObject(entries: readonly KeyedPromiseCombinatorEntry[]): OrdinaryObject {
  const obj = OrdinaryObjectCreate(Value.null);
  for (const entry of entries) {
    X(CreateDataPropertyOrThrow(obj, entry.Key, entry.Value));
  }
  return obj;
}

/** https://tc39.es/ecma262/#sec-promise.allsettled */
function* Promise_allSettled([iterable = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const constructor = thisValue;
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  __ts_cast__<FunctionObject>(constructor);

  const promiseResolve = yield* GetPromiseResolve(constructor);
  __ts_cast__<FunctionObject>(promiseResolve);

  IfAbruptRejectPromise(promiseResolve, promiseCapability);

  const iteratorRecord = yield* GetIterator(iterable, 'sync');
  IfAbruptRejectPromise(iteratorRecord, promiseCapability);
  __ts_cast__<IteratorRecord>(iteratorRecord);

  // 7. Let result be PerformPromiseAllSettled(iteratorRecord, C, promiseCapability, promiseResolve).
  let result: ValueCompletion = yield* PerformPromiseAllSettled(iteratorRecord, constructor, promiseCapability, promiseResolve);

  if (result instanceof AbruptCompletion) {
    if (!iteratorRecord.Done) {
      result = yield* IteratorClose(iteratorRecord, result);
    }
    IfAbruptRejectPromise(result, promiseCapability);
  }

  return result;
}


/** https://tc39.es/ecma262/#sec-performpromiseallsettled */
function* PerformPromiseAllSettled(iteratorRecord: IteratorRecord, constructor: FunctionObject, resultCapability: PromiseCapabilityRecord, promiseResolve: FunctionObject): ValueEvaluator {
  Assert(IsConstructor(constructor));
  Assert(resultCapability instanceof PromiseCapabilityRecord);
  Assert(IsCallable(promiseResolve));
  const values: Value[] = [];
  const remainingElementsCount = { Value: 1 };
  let index = 0;

  // 7. Repeat,
  while (true) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // d. If next is done,
    if (next === 'done') {
      remainingElementsCount.Value -= 1;
      if (remainingElementsCount.Value === 0) {
        // 1. Let valuesArray be ! CreateArrayFromList(values).
        const valuesArray = X(CreateArrayFromList(values));
        // 2. Perform ? Call(resultCapability.[[Resolve]], undefined, « valuesArray »).
        Q(yield* Call(resultCapability.Resolve, Value.undefined, [valuesArray]));
      }

      return resultCapability.Promise;
    }

    values.push(Value.undefined);
    // i. Let nextPromise be ? Call(promiseResolve, constructor, « next »).
    const nextPromise = Q(yield* Call(promiseResolve, constructor, [next]));

    // j. Let fulfilledSteps be the algorithm steps defined in Promise.allSettled Resolve Element Functions.
    const fulfilledSteps = function* PromiseAllSettledResolveElementFunctions([value = Value.undefined]: Arguments): ValueEvaluator {
      const F = surroundingAgent.activeFunctionObject as PromiseAllResolveElementFunctionObject;
      const alreadyCalled = F.AlreadyCalled;
      if (alreadyCalled.Value === true) {
        return Value.undefined;
      }
      alreadyCalled.Value = true;
      const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
      X(CreateDataProperty(obj, 'status', Value('fulfilled')));
      X(CreateDataProperty(obj, 'value', value));
      const thisIndex = F.Index;
      values[thisIndex] = obj;
      remainingElementsCount.Value -= 1;
      if (remainingElementsCount.Value === 0) {
        const valuesArray = CreateArrayFromList(values);
        return Q(yield* Call(resultCapability.Resolve, Value.undefined, [valuesArray]));
      }
      return Value.undefined;
    };

    // l. Let onFulfilled be ! CreateBuiltinFunction(fulfilledSteps, 1, "", « [[AlreadyCalled]], [[Index]] »).
    const onFulfilled = X(CreateBuiltinFunction(fulfilledSteps, 1, Value(''), [
      'AlreadyCalled',
      'Index',
      'Values',
      'Capability',
      'RemainingElements',
    ])) as Mutable<PromiseAllResolveElementFunctionObject>;

    const alreadyCalled = { Value: false };
    onFulfilled.AlreadyCalled = alreadyCalled;
    onFulfilled.Index = index;

    // s. Let rejectedSteps be the algorithm steps defined in Promise.allSettled Reject Element Functions.
    const rejectedSteps = function* PromiseAllSettledRejectElementFunctions([error = Value.undefined]: Arguments): ValueEvaluator {
      const F = surroundingAgent.activeFunctionObject as PromiseAllResolveElementFunctionObject;
      const alreadyCalled = F.AlreadyCalled;
      if (alreadyCalled.Value === true) {
        return Value.undefined;
      }
      alreadyCalled.Value = true;
      const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
      X(CreateDataProperty(obj, 'status', Value('rejected')));
      X(CreateDataProperty(obj, 'reason', error));
      const thisIndex = F.Index;
      values[thisIndex] = obj;
      remainingElementsCount.Value -= 1;
      if (remainingElementsCount.Value === 0) {
        const valuesArray = X(CreateArrayFromList(values));
        return Q(yield* Call(resultCapability.Resolve, Value.undefined, [valuesArray]));
      }
      return Value.undefined;
    };

    // u. Let onRejected be ! CreateBuiltinFunction(rejectedSteps, 1, "", « [[AlreadyCalled]], [[Index]] »).
    const onRejected = X(CreateBuiltinFunction(rejectedSteps, 1, Value(''), ['AlreadyCalled', 'Index'])) as Mutable<PromiseAllResolveElementFunctionObject>;
    onRejected.AlreadyCalled = alreadyCalled;
    onRejected.Index = index;
    index += 1;
    remainingElementsCount.Value += 1;
    Q(yield* Invoke(nextPromise, 'then', [onFulfilled, onRejected]));
  }
}


/** https://tc39.es/proposal-await-dictionary/#sec-promise.allsettledkeyed */
function* Promise_allSettledKeyed([promises = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const constructor = thisValue;
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  __ts_cast__<FunctionObject>(constructor);

  const promiseResolve = EnsureCompletion(yield* GetPromiseResolve(constructor));
  IfAbruptRejectPromise(promiseResolve, promiseCapability);
  __ts_cast__<FunctionObject>(promiseResolve);

  if (!(promises instanceof ObjectValue)) {
    const error = Throw.TypeError('$1 is not an object', promises).Value;
    Q(yield* Call(promiseCapability.Reject, Value.undefined, [error]));
    return promiseCapability.Promise;
  }

  // 6. Let result be Completion(PerformPromiseAllKeyed(all, promises, C, promiseCapability, promiseResolve)).
  const result = EnsureCompletion(yield* PerformPromiseAllKeyed('all-settled', promises, constructor, promiseCapability, promiseResolve));
  IfAbruptRejectPromise(result, promiseCapability);
  return promiseCapability.Promise;
}

/** https://tc39.es/ecma262/#sec-performpromiseany */
function* PerformPromiseAny(iteratorRecord: IteratorRecord, constructor: FunctionObject, resultCapability: PromiseCapabilityRecord, promiseResolve: FunctionObject): ValueEvaluator {
  // 1. Assert: ! IsConstructor(constructor) is true.
  Assert(IsConstructor(constructor));
  // 2. Assert: resultCapability is a PromiseCapability Record.
  Assert(resultCapability instanceof PromiseCapabilityRecord);
  // 3. Assert: ! IsCallable(promiseResolve) is true.
  Assert(IsCallable(promiseResolve));
  // 4. Let errors be a new empty List.
  const errors: Value[] = [];
  // 5. Let remainingElementsCount be a new Record { [[Value]]: 1 }.
  const remainingElementsCount = { Value: 1 };
  // 6. Let index be 0.
  let index = 0;
  // 7. Repeat,
  while (true) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // d. If next is done, then
    if (next === 'done') {
      // ii. Set remainingElementsCount.[[Value]] to remainingElementsCount.[[Value]] - 1.
      remainingElementsCount.Value -= 1;
      // iii. If remainingElementsCount.[[Value]] is 0, then
      if (remainingElementsCount.Value === 0) {
        // 1. Let aggregateError be a newly created AggregateError object.
        const aggregateError = Throw.AggregateError('No promises passed to Promise.any were fulfilled').Value as ObjectValue;
        // 2. Perform ! DefinePropertyOrThrow(aggregateError, "errors", Property Descriptor { [[Configurable]]: true, [[Enumerable]]: false, [[Writable]]: true, [[Value]]: errors }).
        X(DefinePropertyOrThrow(aggregateError, 'errors', Descriptor({
          Configurable: true,
          Enumerable: false,
          Writable: true,
          Value: X(CreateArrayFromList(errors)),
        })));
        // 3. Perform ? Call(resultCapability.[[Reject]], *undefined*, « _aggregateError_ »).
        Q(yield* Call(resultCapability.Reject, Value.undefined, [aggregateError]));
      }
      // iv. Return resultCapability.[[Promise]].
      return resultCapability.Promise;
    }
    // h. Append undefined to errors.
    errors.push(Value.undefined);
    // i. Let nextPromise be ? Call(promiseResolve, constructor, « next »).
    const nextPromise = Q(yield* Call(promiseResolve, constructor, [next]));
    const rejectedSteps = function* PromiseAnyRejectElementFunctions([error = Value.undefined]: Arguments): ValueEvaluator {
      const F = surroundingAgent.activeFunctionObject as PromiseAllRejectElementFunctionObject;
      const alreadyCalled = F.AlreadyCalled;
      if (alreadyCalled.Value) {
        return Value.undefined;
      }
      alreadyCalled.Value = true;
      const thisIndex = F.Index;
      errors[thisIndex] = error;
      remainingElementsCount.Value -= 1;
      if (remainingElementsCount.Value === 0) {
        const aggregateError = Throw.AggregateError('No promises passed to Promise.any were fulfilled').Value as ObjectValue;
        X(DefinePropertyOrThrow(aggregateError, 'errors', Descriptor({
          Configurable: true,
          Enumerable: false,
          Writable: true,
          Value: X(CreateArrayFromList(errors)),
        })));
        return Q(yield* Call(resultCapability.Reject, Value.undefined, [aggregateError]));
      }
      return Value.undefined;
    };
    // l. Let onRejected be ! CreateBuiltinFunction(stepsRejected, lengthRejected, "", « [[AlreadyCalled]], [[Index]], [[Errors]], [[Capability]], [[RemainingElements]] »).
    const onRejected = X(CreateBuiltinFunction(rejectedSteps, 1, Value(''), ['AlreadyCalled', 'Index'])) as Mutable<PromiseAllRejectElementFunctionObject>;
    onRejected.AlreadyCalled = { Value: false };
    onRejected.Index = index;
    index += 1;
    remainingElementsCount.Value += 1;
    Q(yield* Invoke(nextPromise, 'then', [resultCapability.Resolve, onRejected]));
  }
}

/** https://tc39.es/ecma262/#sec-promise.any */
function* Promise_any([iterable = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be the this value.
  const constructor = thisValue;
  // 2. Let promiseCapability be ? NewPromiseCapability(C).
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  __ts_cast__<FunctionObject>(constructor);
  // 3. Let promiseResolve be GetPromiseResolve(C).
  const promiseResolve = yield* GetPromiseResolve(constructor);
  // 4. IfAbruptRejectPromise(promiseResolve, promiseCapability).
  IfAbruptRejectPromise(promiseResolve, promiseCapability);
  __ts_cast__<FunctionObject>(promiseResolve);
  // 5. Let iteratorRecord be GetIterator(iterable).
  const iteratorRecord = yield* GetIterator(iterable, 'sync');
  // 6. IfAbruptRejectPromise(iteratorRecord, promiseCapability).
  IfAbruptRejectPromise(iteratorRecord, promiseCapability);
  __ts_cast__<IteratorRecord>(iteratorRecord);
  // 7. Let result be PerformPromiseAny(iteratorRecord, C, promiseCapability).
  let result: ValueCompletion = yield* PerformPromiseAny(iteratorRecord, constructor, promiseCapability, promiseResolve);
  // 8. If result is an abrupt completion, then
  if (result instanceof AbruptCompletion) {
    // a. If iteratorRecord.[[Done]] is false, set result to IteratorClose(iteratorRecord, result).
    if (!iteratorRecord.Done) {
      result = yield* IteratorClose(iteratorRecord, result);
    }
    // b. IfAbruptRejectPromise(result, promiseCapability).
    IfAbruptRejectPromise(result, promiseCapability);
  }
  // 9. Return ? result.
  return result;
}

function* PerformPromiseRace(iteratorRecord: IteratorRecord, constructor: FunctionObject, resultCapability: PromiseCapabilityRecord, promiseResolve: FunctionObject): ValueEvaluator {
  // 1. Assert: IsConstructor(constructor) is true.
  Assert(IsConstructor(constructor));
  // 2. Assert: resultCapability is a PromiseCapability Record.
  Assert(resultCapability instanceof PromiseCapabilityRecord);
  // 3. Assert: IsCallable(promiseResolve) is true.
  Assert(IsCallable(promiseResolve));
  // 4. Repeat,
  while (true) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // d. If next is done, then
    if (next === 'done') {
      // ii. Return resultCapability.[[Promise]].
      return resultCapability.Promise;
    }
    // h. Let nextPromise be ? Call(promiseResolve, constructor, « next »).
    const nextPromise = Q(yield* Call(promiseResolve, constructor, [next]));
    // i. Perform ? Invoke(nextPromise, "then", « resultCapability.[[Resolve]], resultCapability.[[Reject]] »).
    Q(yield* Invoke(nextPromise, 'then', [resultCapability.Resolve, resultCapability.Reject]));
  }
}

/** https://tc39.es/ecma262/#sec-promise.race */
function* Promise_race([iterable = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be the this value.
  const constructor = thisValue;
  // 2. Let promiseCapability be ? NewPromiseCapability(C).
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  __ts_cast__<FunctionObject>(constructor);
  // 3. Let promiseResolve be GetPromiseResolve(C).
  const promiseResolve = yield* GetPromiseResolve(constructor);
  __ts_cast__<FunctionObject>(promiseResolve);
  // 4. IfAbruptRejectPromise(promiseResolve, promiseCapability).
  IfAbruptRejectPromise(promiseResolve, promiseCapability);
  // 5. Let iteratorRecord be GetIterator(iterable).
  const iteratorRecord = yield* GetIterator(iterable, 'sync');
  // 6. IfAbruptRejectPromise(iteratorRecord, promiseCapability).
  IfAbruptRejectPromise(iteratorRecord, promiseCapability);
  __ts_cast__<IteratorRecord>(iteratorRecord);
  // 7. Let result be PerformPromiseRace(iteratorRecord, C, promiseCapability, promiseResolve).
  let result: ValueCompletion = yield* PerformPromiseRace(iteratorRecord, constructor, promiseCapability, promiseResolve);
  // 8. If result is an abrupt completion, then
  if (result instanceof AbruptCompletion) {
    // a. If iteratorRecord.[[Done]] is false, set result to IteratorClose(iteratorRecord, result).
    if (!iteratorRecord.Done) {
      result = yield* IteratorClose(iteratorRecord, result);
    }
    // b. IfAbruptRejectPromise(result, promiseCapability).
    IfAbruptRejectPromise(result, promiseCapability);
  }
  // 9. Return ? result.
  return result;
}

/** https://tc39.es/ecma262/#sec-promise.reject */
function* Promise_reject([r = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be this value.
  const constructor = thisValue;
  // 2. Let promiseCapability be ? NewPromiseCapability(C).
  const promiseCapability = Q(yield* NewPromiseCapability(constructor));
  // 3. Perform ? Call(promiseCapability.[[Reject]], undefined, « r »).
  Q(yield* Call(promiseCapability.Reject, Value.undefined, [r]));
  // 4. Return promiseCapability.[[Promise]].
  return promiseCapability.Promise;
}

/** https://tc39.es/ecma262/#sec-promise.resolve */
function* Promise_resolve([x = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be the this value.
  const constructor = thisValue;
  // 2. If Type(C) is not Object, throw a TypeError exception.
  if (!(constructor instanceof ObjectValue)) {
    return Throw.TypeError('$1 called on invalid receiver: $2', 'Promise.resolve', constructor);
  }
  // 3. Return ? PromiseResolve(C, x).
  return Q(yield* PromiseResolve(constructor, x));
}

/** https://tc39.es/ecma262/#sec-get-promise-@@species */
function Promise_symbolSpecies(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Return the this value.
  return thisValue;
}

/** https://tc39.es/ecma262/#sec-promise.try */
function* Promise_try([callback = Value.undefined, ...args]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be the this value.
  const constructor = thisValue;
  // 2. If C is not an Object, throw a TypeError exception.
  if (!(constructor instanceof ObjectValue)) {
    return Throw.TypeError('$1 called on invalid receiver: $2', 'Promise.try', constructor);
  }
  // 4. Let status be Completion(Call(callback, undefined, args)).
  const status = EnsureCompletion(yield* Call(callback, Value.undefined, args as Arguments));

  if (status instanceof AbruptCompletion) {
    const promiseCapability: PromiseCapabilityRecord = Q(yield* NewPromiseCapability(constructor));
    // 5. If status is an abrupt completion, then
    //   a. Perform ? Call(promiseCapability.[[Reject]], undefined, « status.[[Value]] »).
    Q(yield* Call(promiseCapability.Reject, Value.undefined, [status.Value]));
    return promiseCapability.Promise;
  } else {
    return Q(yield* PromiseResolve(constructor, X(status)));
  }
}

/** https://tc39.es/ecma262/#sec-promise.withResolvers */
function* Promise_withResolvers(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let C be the this value.
  const constructor = thisValue;
  // 2. Let promiseCapability be ? NewPromiseCapability(C).
  const promiseCapability: PromiseCapabilityRecord = Q(yield* NewPromiseCapability(constructor));
  // 3. Let obj be OrdinaryObjectCreate(%Object.prototype%).
  const obj = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%')));
  // 4. Perform ! CreateDataPropertyOrThrow(obj, "promise", promiseCapability.[[Promise]]).
  X(CreateDataPropertyOrThrow(obj, 'promise', promiseCapability.Promise));
  // 5. Perform ! CreateDataPropertyOrThrow(obj, "resolve", promiseCapability.[[Resolve]]).
  X(CreateDataPropertyOrThrow(obj, 'resolve', promiseCapability.Resolve));
  // 6. Perform ! CreateDataPropertyOrThrow(obj, "reject", promiseCapability.[[Reject]]).
  X(CreateDataPropertyOrThrow(obj, 'reject', promiseCapability.Reject));
  // 7. Return obj.
  return EnsureCompletion(obj);
}

export function bootstrapPromise(realmRec: Realm) {
  const promiseConstructor = bootstrapConstructor(realmRec, PromiseConstructor, 'Promise', 1, realmRec.Intrinsics['%Promise.prototype%'], [
    ['all', Promise_all, 1],
    ['allSettled', Promise_allSettled, 1],
    ['any', Promise_any, 1],
    ['race', Promise_race, 1],
    ['reject', Promise_reject, 1],
    ['resolve', Promise_resolve, 1],
    ['try', Promise_try, 1],
    ['withResolvers', Promise_withResolvers, 0],
    [wellKnownSymbols.species, [Promise_symbolSpecies]],
    ['allKeyed', Promise_allKeyed, 1],
    ['allSettledKeyed', Promise_allSettledKeyed, 1],
  ]);

  X(promiseConstructor.DefineOwnProperty(Value('prototype'), Descriptor({
    Writable: false,
    Enumerable: false,
    Configurable: false,
  })));

  realmRec.Intrinsics['%Promise%'] = promiseConstructor;
  realmRec.Intrinsics['%Promise.resolve%'] = X(Get(promiseConstructor, 'resolve')) as FunctionObject;
}
