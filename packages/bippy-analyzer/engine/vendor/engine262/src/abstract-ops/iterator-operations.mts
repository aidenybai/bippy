import {
  JSStringValue,
  ObjectValue,
  UndefinedValue,
  Value,
  wellKnownSymbols,
  type Arguments,
} from '../value.mts';
import {
  Completion,
  EnsureCompletion,
  IfAbruptRejectPromise,
  Q, X,
  Await,
  NormalCompletion,
  type ValueEvaluator,
  ThrowCompletion,
  AbruptCompletion,
} from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import type { AsyncFromSyncIteratorObject } from '../intrinsics/AsyncFromSyncIteratorPrototype.mts';
import type {
  Evaluator, PlainEvaluator, YieldEvaluator,
} from '../evaluator.mts';
import {
  Assert,
  Call,
  CreateBuiltinFunction,
  Get,
  GetMethod,
  PromiseResolve,
  OrdinaryObjectCreate,
  PerformPromiseThen,
  ToBoolean,
  CreateIteratorFromClosure,
  type FunctionObject,
  PromiseCapabilityRecord,
  CreateDataPropertyOrThrow,
  GeneratorYield,
  Yield,
  type GeneratorObject,
} from './all.mts';
import { surroundingAgent, type PlainCompletion } from '#self';
import {
  type ValueCompletion, type PromiseObject, type OrdinaryObject, Throw,
  ReturnCompletion,
  IfAbruptCloseIterators,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-operations-on-iterator-objects */
// and
/** https://tc39.es/ecma262/#sec-iteration */

export interface IteratorRecord {
  readonly Iterator: ObjectValue;
  readonly NextMethod: Value;
  Done: boolean;
}

export interface IteratorObject extends OrdinaryObject {
  Iterated: IteratorRecord;
}

/** https://tc39.es/ecma262/#sec-getiteratordirect */
export function* GetIteratorDirect(obj: ObjectValue): PlainEvaluator<IteratorRecord> {
  const nextMethod = Q(yield* Get(obj, 'next'));
  const iteratorRecord: IteratorRecord = {
    Iterator: obj,
    NextMethod: nextMethod,
    Done: false,
  };
  return iteratorRecord;
}

/** https://tc39.es/ecma262/#sec-getiteratorfrommethod */
export function* GetIteratorFromMethod(obj: Value, method: FunctionObject): PlainEvaluator<IteratorRecord> {
  const iterator = Q(yield* Call(method, obj));
  if (!(iterator instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', iterator);
  }
  return yield* GetIteratorDirect(iterator);
}

/** https://tc39.es/ecma262/#sec-getiterator */
export function* GetIterator(obj: Value, kind: 'sync' | 'async'): PlainEvaluator<IteratorRecord> {
  let method;
  if (kind === 'async') {
    method = Q(yield* GetMethod(obj, wellKnownSymbols.asyncIterator));
    if (method === Value.undefined) {
      const syncMethod = Q(yield* GetMethod(obj, wellKnownSymbols.iterator));
      if (syncMethod instanceof UndefinedValue) {
        return Throw.TypeError('$1 is not iterable', obj);
      }
      const syncIteratorRecord = Q(yield* GetIteratorFromMethod(obj, syncMethod));
      return CreateAsyncFromSyncIterator(syncIteratorRecord);
    }
  } else {
    method = Q(yield* GetMethod(obj, wellKnownSymbols.iterator));
  }
  if (method instanceof UndefinedValue) {
    return Throw.TypeError('$1 is not iterable', obj);
  }
  return yield* GetIteratorFromMethod(obj, method);
}

export type PrimitiveHanding = 'iterate-string-primitives' | 'reject-primitives'
export function* GetIteratorFlattenable(obj: Value, primitiveHandling: PrimitiveHanding): PlainEvaluator<IteratorRecord> {
  if (!(obj instanceof ObjectValue)) {
    if (primitiveHandling === 'reject-primitives') {
      return Throw.TypeError('$1 is not an object', obj);
    }
    Assert(primitiveHandling === 'iterate-string-primitives');
    if (!(obj instanceof JSStringValue)) {
      return Throw.TypeError('$1 is not a string', obj);
    }
  }
  const method = Q(yield* GetMethod(obj, wellKnownSymbols.iterator));
  let iterator;
  if (method instanceof UndefinedValue) {
    iterator = obj;
  } else {
    iterator = Q(yield* Call(method, obj));
  }
  if (!(iterator instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', iterator);
  }
  return yield* GetIteratorDirect(iterator);
}

/** https://tc39.es/ecma262/#sec-iteratornext */
export function* IteratorNext(iteratorRecord: IteratorRecord, value?: Value): ValueEvaluator<ObjectValue> {
  let result;
  if (!value) {
    result = EnsureCompletion(yield* Call(iteratorRecord.NextMethod, iteratorRecord.Iterator));
  } else {
    result = EnsureCompletion(yield* Call(iteratorRecord.NextMethod, iteratorRecord.Iterator, [value]));
  }
  if (result instanceof ThrowCompletion) {
    iteratorRecord.Done = true;
    return Q(result);
  }
  result = X(result);
  if (!(result instanceof ObjectValue)) {
    iteratorRecord.Done = true;
    return Throw.TypeError('$1 is not an object', result);
  }
  return result;
}

/** https://tc39.es/ecma262/#sec-iteratorcomplete */
export function* IteratorComplete(iteratorResult: ObjectValue): PlainEvaluator<boolean> {
  return ToBoolean(Q(yield* Get(iteratorResult, 'done')));
}

/** https://tc39.es/ecma262/#sec-iteratorvalue */
export function IteratorValue(iterResult: ObjectValue): ValueEvaluator {
  return Get(iterResult, 'value');
}

/** https://tc39.es/ecma262/#sec-iteratorstep */
export function* IteratorStep(iteratorRecord: IteratorRecord): PlainEvaluator<ObjectValue | 'done'> {
  const result = Q(yield* IteratorNext(iteratorRecord));
  let done: PlainCompletion<boolean> = EnsureCompletion(yield* IteratorComplete(result));
  if (done instanceof ThrowCompletion) {
    iteratorRecord.Done = true;
    return done;
  }
  done = X(done);
  if (done) {
    iteratorRecord.Done = true;
    return 'done';
  }
  return result;
}

/** https://tc39.es/ecma262/#sec-iteratorstepvalue */
export function* IteratorStepValue(iteratorRecord: IteratorRecord): PlainEvaluator<Value | 'done'> {
  const result = Q(yield* IteratorStep(iteratorRecord));
  if (result === 'done') {
    return 'done';
  }
  const value = EnsureCompletion(yield* IteratorValue(result));
  if (value instanceof ThrowCompletion) {
    iteratorRecord.Done = true;
  }
  return value;
}

/** https://tc39.es/ecma262/#sec-iteratorclose */
export function* IteratorClose<T, C extends Completion<T>>(iteratorRecord: IteratorRecord, completion: C): Evaluator<C | ThrowCompletion> {
  Assert(iteratorRecord.Iterator instanceof ObjectValue);
  const iterator = iteratorRecord.Iterator;
  let innerResult: ValueCompletion = EnsureCompletion(yield* GetMethod(iterator, 'return'));
  if (innerResult instanceof NormalCompletion) {
    const ret = innerResult.Value;
    if (ret === Value.undefined) {
      return completion;
    }
    innerResult = EnsureCompletion(yield* Call(ret, iterator));
  }
  if (completion instanceof ThrowCompletion) {
    return completion;
  }
  if (innerResult instanceof ThrowCompletion) {
    return innerResult;
  }
  if (!(innerResult.Value instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', innerResult.Value);
  }
  return completion;
}

/** https://tc39.es/ecma262/#sec-iteratorcloseall */
export function* IteratorCloseAll<C>(iters: Iterable<IteratorRecord>, completion: Completion<C>): Evaluator<Completion<C>> {
  for (const iter of [...iters].reverse()) {
    completion = yield* IteratorClose(iter, completion);
  }
  return completion;
}

/** https://tc39.es/ecma262/#sec-asynciteratorclose */
export function* AsyncIteratorClose<T, C extends Completion<T>>(iteratorRecord: IteratorRecord, completion: C | T) {
  Assert(iteratorRecord.Iterator instanceof ObjectValue);
  const iterator = iteratorRecord.Iterator;
  let innerResult: NormalCompletion<Value> | ThrowCompletion = EnsureCompletion(yield* GetMethod(iterator, 'return'));
  if (innerResult instanceof NormalCompletion) {
    const ret = innerResult.Value;
    if (ret instanceof UndefinedValue) {
      return completion;
    }
    innerResult = EnsureCompletion(yield* Call(ret, iterator));
    if (innerResult instanceof NormalCompletion) {
      innerResult = EnsureCompletion(yield* Await(innerResult.Value));
    }
  }
  if (completion instanceof ThrowCompletion) {
    return completion;
  }
  if (innerResult instanceof ThrowCompletion) {
    return innerResult;
  }
  if (!(innerResult.Value instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', innerResult.Value);
  }
  return completion;
}

/** https://tc39.es/ecma262/#sec-createiterresultobject */
export function CreateIteratorResultObject(value: Value, done: boolean) {
  const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  X(CreateDataPropertyOrThrow(obj, 'value', value));
  X(CreateDataPropertyOrThrow(obj, 'done', Value(done)));
  return obj;
}

/** https://tc39.es/ecma262/#sec-createlistiteratorRecord */
export function CreateListIteratorRecord(list: Iterable<Value>): IteratorRecord {
  const closure = function* closure(): YieldEvaluator {
    for (const E of list) {
      Q(yield* GeneratorYield(CreateIteratorResultObject(E, false)));
    }
    return NormalCompletion(Value.undefined);
  };
  const iterator = CreateIteratorFromClosure(closure, undefined, surroundingAgent.intrinsic('%Iterator.prototype%'));
  return {
    Iterator: iterator,
    NextMethod: surroundingAgent.intrinsic('%GeneratorFunction.prototype.prototype.next%'),
    Done: false,
  };
}

/** https://tc39.es/ecma262/#sec-iteratortolist */
export function* IteratorToList(iteratorRecord: IteratorRecord): PlainEvaluator<Value[]> {
  const list: Value[] = [];
  while (true) {
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next === 'done') {
      return list;
    }
    list.push(next);
  }
}

/** https://tc39.es/ecma262/#sec-createasyncfromsynciterator */
export function CreateAsyncFromSyncIterator(syncIteratorRecord: IteratorRecord): IteratorRecord {
  const asyncIterator = OrdinaryObjectCreate(surroundingAgent.intrinsic('%AsyncFromSyncIteratorPrototype%'), [
    'SyncIteratorRecord',
  ]) as Mutable<AsyncFromSyncIteratorObject>;
  asyncIterator.SyncIteratorRecord = syncIteratorRecord;
  const nextMethod = X(Get(asyncIterator, 'next'));
  return {
    Iterator: asyncIterator,
    NextMethod: nextMethod,
    Done: false,
  };
}

/** https://tc39.es/ecma262/#sec-asyncfromsynciteratorcontinuation */
export function* AsyncFromSyncIteratorContinuation(result: ObjectValue, promiseCapability: PromiseCapabilityRecord, syncIteratorRecord: IteratorRecord, closeOnRejection: boolean): ValueEvaluator<PromiseObject> {
  const done = yield* IteratorComplete(result);
  IfAbruptRejectPromise(done, promiseCapability);
  __ts_cast__<boolean>(done);
  const value = yield* IteratorValue(result);
  IfAbruptRejectPromise(value, promiseCapability);
  __ts_cast__<Value>(value);
  let valueWrapper = yield* PromiseResolve(surroundingAgent.intrinsic('%Promise%'), value);
  if (valueWrapper instanceof AbruptCompletion && !done && closeOnRejection) {
    valueWrapper = yield* IteratorClose(syncIteratorRecord, valueWrapper);
  }
  IfAbruptRejectPromise(valueWrapper, promiseCapability);
  __ts_cast__<PromiseObject>(valueWrapper);
  const unwrap = ([v = Value.undefined]: Arguments) => CreateIteratorResultObject(v, done);
  const onFullfilled = CreateBuiltinFunction(unwrap, 1, Value(''), []);
  let onRejected;
  if (done || !closeOnRejection) {
    onRejected = Value.undefined;
  } else {
    const closeIterator = ([error = Value.undefined]: Arguments) => IteratorClose(syncIteratorRecord, ThrowCompletion(error));
    onRejected = CreateBuiltinFunction(closeIterator, 1, Value(''), []);
  }
  PerformPromiseThen(valueWrapper, onFullfilled, onRejected, promiseCapability);
  return promiseCapability.Promise;
}
export type IteratorZipMode = 'shortest' | 'longest' | 'strict';
/** https://tc39.es/ecma262/#sec-IteratorZip */
export function IteratorZip(
  _iters: readonly IteratorRecord[],
  mode: IteratorZipMode,
  padding: readonly Value[],
  finishResults: (results: readonly Value[]) => Value,
) {
  const iters: (null | IteratorRecord)[] = [..._iters];
  const iterCount = iters.length;
  const openIters = [..._iters];
  const closure = function* IteratorZipClosure(): YieldEvaluator {
    if (iterCount === 0) {
      return ReturnCompletion(Value.undefined);
    }
    while (true) {
      const results: Value[] = [];
      Assert(openIters.length !== 0);
      for (let i = 0; i < iterCount; i += 1) {
        const iter = iters[i];
        let result: Value | 'done';
        if (iter === null) {
          Assert(mode === 'longest');
          result = padding[i];
        } else {
          const _result = yield* IteratorStepValue(iter);
          if (_result instanceof AbruptCompletion) {
            // Remove iter from openIters.
            openIters.splice(openIters.indexOf(iter), 1);
            return Q(yield* IteratorCloseAll(openIters, _result));
          }
          result = X(_result);
          if (result === 'done') {
            // Remove iter from openIters.
            openIters.splice(openIters.indexOf(iter), 1);
            if (mode === 'shortest') {
              return Q(yield* IteratorCloseAll(openIters, ReturnCompletion(Value.undefined)));
            } else if (mode === 'strict') {
              if (i !== 0) {
                return Q(yield* IteratorCloseAll(openIters, Throw.TypeError('Iterator.zip strict mode requires all iterators to end together')));
              }
              for (let k = 1; k < iterCount; k += 1) {
                const itersK = iters[k];
                Assert(itersK !== null);
                const _open = yield* IteratorStep(itersK);
                if (_open instanceof AbruptCompletion) {
                  // Remove itersK from openIters.
                  openIters.splice(openIters.indexOf(itersK), 1);
                  return Q(yield* IteratorCloseAll(openIters, _open));
                }
                const open = X(_open);
                if (open === 'done') {
                  // Remove itersK from openIters.
                  openIters.splice(openIters.indexOf(itersK), 1);
                } else {
                  return Q(yield* IteratorCloseAll(openIters, Throw.TypeError('Iterator.zip strict mode requires all iterators to end together')));
                }
              }
              return ReturnCompletion(Value.undefined);
            }
            Assert(mode === 'longest');
            if (openIters.length === 0) {
              return ReturnCompletion(Value.undefined);
            }
            iters[i] = null;
            result = padding[i];
          }
        }
        results.push(result);
      }
      const _results = finishResults(results);
      const completion = yield* Yield(_results);
      IfAbruptCloseIterators(completion, openIters);
    }
  };
  const gen = CreateIteratorFromClosure(
    closure,
    'Iterator Helper',
    surroundingAgent.intrinsic('%IteratorHelperPrototype%'),
    ['UnderlyingIterators'],
  ) as GeneratorObject;
  gen.UnderlyingIterators = openIters;
  return gen;
}
