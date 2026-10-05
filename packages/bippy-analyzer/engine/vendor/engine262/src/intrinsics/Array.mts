import {
  Await,
  IfAbruptCloseIterator,
  Q,
  ThrowCompletion, X,
  type ValueCompletion,
  type ValueEvaluator,
} from '../completion.mts';
import {
  NumberValue,
  ObjectValue,
  UndefinedValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  surroundingAgent,
  Realm,
  IfAbruptCloseAsyncIterator, IteratorValue, Throw,
} from '#self';
import {
  ArrayCreate,
  Assert,
  Call,
  Construct,
  CreateDataPropertyOrThrow,
  Get,
  GetMethod,
  GetPrototypeFromConstructor,
  IsArray,
  IsCallable,
  IsConstructor,
  IteratorClose,
  Set,
  LengthOfArrayLike,
  ToObject,
  ToString,
  ToUint32,
  F, R,
  type FunctionObject,
  IteratorStepValue,
  GetIteratorFromMethod,
  type IteratorRecord,
  CreateAsyncFromSyncIterator,
  AsyncIteratorClose,
  IteratorComplete,
  SameValueZero,
} from '#self';

/** https://tc39.es/ecma262/#sec-array-constructor */
function* ArrayConstructor(values: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  const newTarget = NewTarget instanceof UndefinedValue ? surroundingAgent.activeFunctionObject as FunctionObject : NewTarget;
  const proto = Q(yield* GetPrototypeFromConstructor(newTarget, '%Array.prototype%'));
  const numberOfArgs = values.length;
  if (numberOfArgs === 0) return X(ArrayCreate(0, proto));
  else if (numberOfArgs === 1) {
    const len = values[0]!;
    const array = X(ArrayCreate(0, proto));
    let intLen;
    if (!(len instanceof NumberValue)) {
      X(CreateDataPropertyOrThrow(array, '0', len));
      intLen = F(1);
    } else {
      intLen = X(ToUint32(len));
      if (!SameValueZero(intLen, len)) {
        return Throw.RangeError('$1 is not a valid array length', len);
      }
    }
    X(yield* Set(array, 'length', intLen, true));
    return array;
  }

  const array = Q(ArrayCreate(numberOfArgs, proto));
  let k = 0;
  while (k < numberOfArgs) {
    const Pk = X(ToString(F(k)));
    const itemK = values[k]!;
    X(CreateDataPropertyOrThrow(array, Pk, itemK));
    k += 1;
  }
  Assert(R(X(Get(array, 'length')) as NumberValue) === numberOfArgs);
  return array;
}

/** https://tc39.es/ecma262/#sec-array.from */
function* Array_from([items = Value.undefined, mapper = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  const constructor = thisValue;
  let mapping;
  let array;
  if (mapper === Value.undefined) {
    mapping = false;
  } else {
    if (!IsCallable(mapper)) {
      return Throw.TypeError('$1 is not a function', mapper);
    }
    mapping = true;
  }
  const usingIterator = Q(yield* GetMethod(items, wellKnownSymbols.iterator));
  if (!(usingIterator instanceof UndefinedValue)) {
    if (IsConstructor(constructor)) {
      array = Q(yield* Construct(constructor));
    } else {
      array = X(ArrayCreate(0));
    }
    const iteratorRecord = Q(yield* GetIteratorFromMethod(items, usingIterator));
    let k = 0;
    while (true) { // eslint-disable-line no-constant-condition
      if (k >= (2 ** 53) - 1) {
        const error = ThrowCompletion(Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index').Value);
        return Q(yield* IteratorClose(iteratorRecord, error));
      }
      const Pk = X(ToString(F(k)));
      const next = Q(yield* IteratorStepValue(iteratorRecord));
      if (next === 'done') {
        Q(yield* Set(array, 'length', F(k), true));
        return array;
      }
      let mappedValue;
      if (mapping) {
        mappedValue = yield* Call(mapper, thisArg, [next, F(k)]);
        IfAbruptCloseIterator(mappedValue, iteratorRecord);
        __ts_cast__<Value>(mappedValue);
      } else {
        mappedValue = next;
      }
      const defineStatus = yield* CreateDataPropertyOrThrow(array, Pk, mappedValue);
      IfAbruptCloseIterator(defineStatus, iteratorRecord);
      k += 1;
    }
  }
  const arrayLike = X(ToObject(items));
  const len = Q(yield* LengthOfArrayLike(arrayLike));
  if (IsConstructor(constructor)) {
    array = Q(yield* Construct(constructor, [F(len)]));
  } else {
    array = Q(ArrayCreate(len));
  }
  let k = 0;
  while (k < len) {
    const Pk = X(ToString(F(k)));
    const kValue = Q(yield* Get(arrayLike, Pk));
    let mappedValue;
    if (mapping === true) {
      mappedValue = Q(yield* Call(mapper, thisArg, [kValue, F(k)]));
    } else {
      mappedValue = kValue;
    }
    Q(yield* CreateDataPropertyOrThrow(array, Pk, mappedValue));
    k += 1;
  }
  Q(yield* Set(array, 'length', F(len), true));
  return array;
}

/** https://tc39.es/ecma262/#sec-array.fromasync */
function* Array_fromAsync([items = Value.undefined, mapper = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  const constructor = thisValue;
  let mapping = false;
  if (mapper !== Value.undefined) {
    if (!IsCallable(mapper)) {
      return Throw.TypeError('arguments[1] ($1) is not a function', mapper);
    }
    mapping = true;
  }
  let iteratorRecord: IteratorRecord | undefined;
  const usingAsyncIterator = Q(yield* GetMethod(items, wellKnownSymbols.asyncIterator));
  let usingSyncIterator: UndefinedValue | FunctionObject = Value.undefined;
  if (usingAsyncIterator instanceof UndefinedValue) {
    usingSyncIterator = Q(yield* GetMethod(items, wellKnownSymbols.iterator));
    if (!(usingSyncIterator instanceof UndefinedValue)) {
      iteratorRecord = CreateAsyncFromSyncIterator(Q(yield* GetIteratorFromMethod(items, usingSyncIterator)));
    }
  } else {
    iteratorRecord = Q(yield* GetIteratorFromMethod(items, usingAsyncIterator));
  }

  if (iteratorRecord) {
    const MAX_SAFE_INTEGER = (2 ** 53) - 1;
    let array: ObjectValue;
    if (IsConstructor(constructor)) {
      array = Q(yield* Construct(constructor));
    } else {
      array = X(ArrayCreate(0));
    }

    let k = 0;
    while (true) {
      if (k > MAX_SAFE_INTEGER) {
        const error = Throw.TypeError('Iterator length is bigger than MAX_SAFE_INTEGER');
        return Q(yield* AsyncIteratorClose(iteratorRecord, error));
      }

      const Pk = X(ToString(F(k)));
      let nextResult: Value = Q(yield* Call(iteratorRecord.NextMethod, iteratorRecord.Iterator));
      nextResult = Q(yield* Await(nextResult));
      if (!(nextResult instanceof ObjectValue)) {
        return Throw.TypeError('The return value ($1) of the next() on an iterator ($2) must be an object', nextResult, iteratorRecord.Iterator);
      }
      const done = Q(yield* IteratorComplete(nextResult));
      if (done) {
        Q(yield* Set(array, 'length', F(k), true));
        return array;
      }

      const nextValue: ValueCompletion<Value> = Q(yield* IteratorValue(nextResult));
      let mappedValue;
      if (mapping) {
        mappedValue = (yield* Call(mapper, thisArg, [nextValue, F(k)]));
        IfAbruptCloseAsyncIterator(mappedValue, iteratorRecord);
        __ts_cast__<Value>(mappedValue);
        mappedValue = yield* Await(mappedValue);
        IfAbruptCloseAsyncIterator(mappedValue, iteratorRecord);
        __ts_cast__<Value>(mappedValue);
      } else {
        mappedValue = nextValue;
      }

      const defineStatus = yield* CreateDataPropertyOrThrow(array, Pk, mappedValue);
      IfAbruptCloseAsyncIterator(defineStatus, iteratorRecord);
      k += 1;
    }
  } else {
    const arrayLike = X(ToObject(items));
    const len = Q(yield* LengthOfArrayLike(arrayLike));

    let array: ObjectValue;
    if (IsConstructor(constructor)) {
      array = Q(yield* Construct(constructor, [F(len)]));
    } else {
      array = Q(ArrayCreate(len));
    }

    let k = 0;
    while (k < len) {
      const Pk = X(ToString(F(k)));
      let kValue = Q(yield* Get(arrayLike, Pk));
      kValue = Q(yield* Await(kValue));
      let mappedValue: Value;
      if (mapping) {
        mappedValue = Q(yield* Call(mapper, thisArg, [kValue, F(k)]));
        mappedValue = Q(yield* Await(mappedValue));
      } else {
        mappedValue = kValue;
      }
      Q(yield* CreateDataPropertyOrThrow(array, Pk, mappedValue));
      k += 1;
    }

    Q(yield* Set(array, 'length', F(len), true));
    return array;
  }
}

/** https://tc39.es/ecma262/#sec-array.isarray */
function Array_isArray([arg = Value.undefined]: Arguments): ValueCompletion {
  return Value(Q(IsArray(arg)));
}

/** https://tc39.es/ecma262/#sec-array.of */
function* Array_of(items: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const len = items.length;
  // Let items be the List of arguments passed to this function.
  const constructor = thisValue;
  let array;
  if (IsConstructor(constructor)) {
    array = Q(yield* Construct(constructor, [F(len)]));
  } else {
    array = Q(ArrayCreate(len));
  }
  let k = 0;
  while (k < len) {
    const kValue = items[k]!;
    const Pk = X(ToString(F(k)));
    Q(yield* CreateDataPropertyOrThrow(array, Pk, kValue));
    k += 1;
  }
  Q(yield* Set(array, 'length', F(len), true));
  return array;
}

/** https://tc39.es/ecma262/#sec-get-array-@@species */
function Array_speciesGetter(_args: Arguments, { thisValue }: FunctionCallContext) {
  return thisValue;
}

export function bootstrapArray(realmRec: Realm) {
  const proto = realmRec.Intrinsics['%Array.prototype%'];

  const cons = bootstrapConstructor(realmRec, ArrayConstructor, 'Array', 1, proto, [
    ['from', Array_from, 1],
    ['fromAsync', Array_fromAsync, 1, undefined, true],
    ['isArray', Array_isArray, 1],
    ['of', Array_of, 0],
    [wellKnownSymbols.species, [Array_speciesGetter]],
  ]);

  realmRec.Intrinsics['%Array%'] = cons;
}
