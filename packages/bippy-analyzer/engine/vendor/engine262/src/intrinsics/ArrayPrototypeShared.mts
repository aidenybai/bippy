import {
  NormalCompletion,
  Q, ThrowCompletion, X, type ValueEvaluator,
  type ValueCompletion,
} from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import {
  NullValue, NumberValue, ObjectValue, UndefinedValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { sort } from '../host-defined/sort.mts';
import { assignProps } from './bootstrap.mts';
import { ValidateTypedArray } from './TypedArray.mts';
import {
  Assert,
  Call,
  DeletePropertyOrThrow,
  Get,
  HasProperty,
  Invoke,
  IsCallable,
  SameValueZero,
  Set,
  IsStrictlyEqual,
  ToBoolean,
  ToAbsoluteIndex,
  ToClampedIndex,
  ToObject,
  ToString,
  F, R,
  Realm,
  Throw,
  LengthOfArrayLike, TypedArrayLength,
} from '#self';

// Algorithms and methods shared between %Array.prototype% and
// %TypedArray.prototype%.

/** https://tc39.es/ecma262/#sec-sortindexedproperties */
export function* SortIndexedProperties(obj: ObjectValue, len: number, SortCompare: (x: Value, y: Value) => ValueEvaluator<NumberValue>, holes: 'skip-holes' | 'read-through-holes'): PlainEvaluator<Value[]> {
  const items: Value[] = [];
  let k = 0;
  while (k < len) {
    const Pk = X(ToString(F(k)));
    let kRead: boolean;
    if (holes === 'skip-holes') {
      kRead = Q(yield* HasProperty(obj, Pk));
    } else {
      Assert(holes === 'read-through-holes');
      kRead = true;
    }
    if (kRead) {
      const kValue = Q(yield* Get(obj, Pk));
      items.push(kValue);
    }
    k += 1;
  }
  let completion: ValueCompletion<NumberValue> = NormalCompletion(Value(0));
  yield* sort(items, function* sort(a, b): PlainEvaluator<number> {
    if (completion instanceof ThrowCompletion) {
      return 0;
    }
    Assert(a && b && true);
    completion = yield* SortCompare(a, b);
    if (completion instanceof ThrowCompletion) {
      return 0;
    }
    return R(X(completion));
  });
  if (completion instanceof ThrowCompletion) {
    return completion;
  }
  return items;
}

export function bootstrapArrayPrototypeShared(realmRec: Realm, proto: ObjectValue, kind: 'Array' | 'TypedArray') {
  const Validate = kind === 'Array' ? undefined : (thisValue: Value) => ValidateTypedArray(thisValue, 'seq-cst');
  const ToLength: (O: ObjectValue) => PlainEvaluator<number> = kind === 'Array'
    ? function* ArrayToLength(O) {
      return yield* LengthOfArrayLike(O);
    }
    : function* TypedArrayToLength(O): PlainEvaluator<number> {
      const rec = Q(ValidateTypedArray(O, 'seq-cst'));
      return TypedArrayLength(rec);
    };
  /** https://tc39.es/ecma262/#sec-array.prototype.every */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.every */
  function* ArrayProto_every([callbackFn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(callbackFn)) {
      return Throw.TypeError('$1 is not a function', callbackFn);
    }
    let k = 0;
    while (k < len) {
      const Pk = X(ToString(F(k)));
      let kPresent: boolean;
      if (kind === 'Array') {
        kPresent = Q(yield* HasProperty(O, Pk));
      } else {
        kPresent = true;
      }
      if (kPresent) {
        const kValue = Q(yield* Get(O, Pk));
        const testResult = ToBoolean(Q(yield* Call(callbackFn, thisArg, [kValue, F(k), O])));
        if (!testResult) {
          return Value.false;
        }
      }
      k += 1;
    }
    return Value.true;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.find */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.find */
  function* ArrayProto_find([predicate = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(predicate)) {
      return Throw.TypeError('$1 is not a function', predicate);
    }
    let k = 0;
    while (k < len) {
      const Pk = X(ToString(F(k)));
      const kValue = Q(yield* Get(O, Pk));
      const testResult = ToBoolean(Q(yield* Call(predicate, thisArg, [kValue, F(k), O])));
      if (testResult) {
        return kValue;
      }
      k += 1;
    }
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.findindex */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.findindex */
  function* ArrayProto_findIndex([predicate = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(predicate)) {
      return Throw.TypeError('$1 is not a function', predicate);
    }
    let k = 0;
    while (k < len) {
      const Pk = X(ToString(F(k)));
      const kValue = Q(yield* Get(O, Pk));
      const testResult = ToBoolean(Q(yield* Call(predicate, thisArg, [kValue, F(k), O])));
      if (testResult) {
        return F(k);
      }
      k += 1;
    }
    return F(-1);
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.findlast */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.findlast */
  function* ArrayProto_findLast([predicate = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    // Let O be ? ToObject(this value).
    const O = Q(ToObject(thisValue));
    // 2. Let len be ? LengthOfArrayLike(O).
    const len = Q(yield* ToLength(O));
    // 3. If IsCallable(predicate) is false, throw a TypeError exception.
    if (!IsCallable(predicate)) {
      return Throw.TypeError('$1 is not a function', predicate);
    }
    // 4. Let k be len - 1.
    let k = len - 1;
    // 5. Repeat, while k ≥ 0,
    while (k >= 0) {
      // a. Let Pk be ! ToString(𝔽(k)).
      const Pk = X(ToString(F(k)));
      // b. Let kValue be ? Get(O, Pk).
      const kValue = Q(yield* Get(O, Pk));
      // c. Let testResult be ToBoolean(? Call(predicate, thisArg, « kValue, 𝔽(k), O »)).
      const testResult = ToBoolean(Q(yield* Call(predicate, thisArg, [kValue, F(k), O])));
      // d. If testResult is true, return kValue.
      if (testResult) {
        return kValue;
      }
      // e. Set k to k - 1.
      k -= 1;
    }
    // 6. Return undefined.
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.findlastindex */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.findlastindex */
  function* ArrayProto_findLastIndex([predicate = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    // Let O be ? ToObject(this value).
    const O = Q(ToObject(thisValue));
    // 2. Let len be ? LengthOfArrayLike(O).
    const len = Q(yield* ToLength(O));
    // 3. If IsCallable(predicate) is false, throw a TypeError exception.
    if (!IsCallable(predicate)) {
      return Throw.TypeError('$1 is not a function', predicate);
    }
    // 4. Let k be len - 1.
    let k = len - 1;
    // 5. Repeat, while k ≥ 0,
    while (k >= 0) {
      // a. Let Pk be ! ToString(𝔽(k)).
      const Pk = X(ToString(F(k)));
      // b. Let kValue be ? Get(O, Pk).
      const kValue = Q(yield* Get(O, Pk));
      // c. Let testResult be ToBoolean(? Call(predicate, thisArg, « kValue, 𝔽(k), O »)).
      const testResult = ToBoolean(Q(yield* Call(predicate, thisArg, [kValue, F(k), O])));
      // d. If testResult is true, return 𝔽(k).
      if (testResult) {
        return F(k);
      }
      // e. Set k to k - 1.
      k -= 1;
    }
    // 6. Return Return -1𝔽.
    return F(-1);
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.foreach */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.foreach */
  function* ArrayProto_forEach([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(callbackfn)) {
      return Throw.TypeError('$1 is not a function', callbackfn);
    }
    let k = 0;
    while (k < len) {
      const Pk = X(ToString(F(k)));
      let kPresent: boolean;
      if (kind === 'Array') {
        kPresent = Q(yield* HasProperty(O, Pk));
      } else {
        kPresent = true;
      }
      if (kPresent) {
        const kValue = Q(yield* Get(O, Pk));
        Q(yield* Call(callbackfn, thisArg, [kValue, F(k), O]));
      }
      k += 1;
    }
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.includes */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.includes */
  function* ArrayProto_includes([searchElement = Value.undefined, fromIndex = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const obj = Q(ToObject(thisValue));
    const length = Q(yield* ToLength(obj));
    if (length === 0) {
      return Value.false;
    }
    let k = Q(yield* ToClampedIndex(fromIndex, length));
    while (k < length) {
      const kStr = X(ToString(F(k)));
      const elementK = Q(yield* Get(obj, kStr));
      if (SameValueZero(searchElement, elementK)) {
        return Value.true;
      }
      k += 1;
    }
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.indexof */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.indexof */
  function* ArrayProto_indexOf([searchElement = Value.undefined, fromIndex = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const length = Q(yield* ToLength(O));
    if (length === 0) {
      return F(-1);
    }
    let k = Q(yield* ToClampedIndex(fromIndex, length));
    while (k < length) {
      const kStr = X(ToString(F(k)));
      const kPresent = Q(yield* HasProperty(O, kStr));
      if (kPresent) {
        const elementK = Q(yield* Get(O, kStr));
        const same = IsStrictlyEqual(searchElement, elementK);
        if (same) {
          return F(k);
        }
      }
      k += 1;
    }
    return F(-1);
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.join */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.join */
  function* ArrayProto_join([separator = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    let sep;
    if (separator instanceof UndefinedValue) {
      sep = ',';
    } else {
      sep = Q(yield* ToString(separator));
    }
    let R = '';
    let k = 0;
    while (k < len) {
      if (k > 0) {
        R = `${R}${sep}`;
      }
      const kStr = X(ToString(F(k)));
      const element = Q(yield* Get(O, kStr));
      let next: string;
      if (element instanceof UndefinedValue || element instanceof NullValue) {
        next = '';
      } else {
        next = Q(yield* ToString(element));
      }
      R = `${R}${next}`;
      k += 1;
    }
    return Value(R);
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.lastindexof */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.lastindexof */
  function* ArrayProto_lastIndexOf([searchElement = Value.undefined, fromIndex]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const length = Q(yield* ToLength(O));
    if (length === 0) {
      return F(-1);
    }
    let k;
    if (fromIndex === undefined) {
      k = length - 1;
    } else {
      k = Math.min(Q(yield* ToAbsoluteIndex(fromIndex, length)), length - 1);
    }
    while (k >= 0) {
      const kStr = X(ToString(F(k)));
      const kPresent = Q(yield* HasProperty(O, kStr));
      if (kPresent) {
        const elementK = Q(yield* Get(O, kStr));
        const same = IsStrictlyEqual(searchElement, elementK);
        if (same) {
          return F(k);
        }
      }
      k -= 1;
    }
    return F(-1);
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.reduce */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.reduce */
  function* ArrayProto_reduce([callbackfn = Value.undefined, initialValue]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(callbackfn)) {
      return Throw.TypeError('$1 is not a function', callbackfn);
    }
    if (len === 0 && initialValue === undefined) {
      return Throw.TypeError('Cannot reduce an empty array with no initial value');
    }
    let k = 0;
    let accumulator: Value = Value.undefined;
    if (initialValue !== undefined) {
      accumulator = initialValue;
    } else {
      let kPresent = false;
      while (kPresent === false && k < len) {
        const Pk = X(ToString(F(k)));
        if (kind === 'Array') {
          kPresent = Q(yield* HasProperty(O, Pk));
        } else {
          kPresent = true;
        }
        if (kPresent === true) {
          accumulator = Q(yield* Get(O, Pk));
        }
        k += 1;
      }
      if (kPresent === false) {
        return Throw.TypeError('Cannot reduce an empty array with no initial value');
      }
    }
    while (k < len) {
      const Pk = X(ToString(F(k)));
      let kPresent: boolean;
      if (kind === 'Array') {
        kPresent = Q(yield* HasProperty(O, Pk));
      } else {
        kPresent = true;
      }
      if (kPresent) {
        const kValue = Q(yield* Get(O, Pk));
        accumulator = Q(yield* Call(callbackfn, Value.undefined, [accumulator, kValue, F(k), O]));
      }
      k += 1;
    }
    return accumulator;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.reduceright */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.reduceright */
  function* ArrayProto_reduceRight([callbackfn = Value.undefined, initialValue]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(callbackfn)) {
      return Throw.TypeError('$1 is not a function', callbackfn);
    }
    if (len === 0 && initialValue === undefined) {
      return Throw.TypeError('Cannot reduce an empty array with no initial value');
    }
    let k = len - 1;
    let accumulator: Value = Value.undefined;
    if (initialValue !== undefined) {
      accumulator = initialValue;
    } else {
      let kPresent = false;
      while (kPresent === false && k >= 0) {
        const Pk = X(ToString(F(k)));
        if (kind === 'Array') {
          kPresent = Q(yield* HasProperty(O, Pk));
        } else {
          kPresent = true;
        }
        if (kPresent === true) {
          accumulator = Q(yield* Get(O, Pk));
        }
        k -= 1;
      }
      if (kPresent === false) {
        return Throw.TypeError('Cannot reduce an empty array with no initial value');
      }
    }
    while (k >= 0) {
      const Pk = X(ToString(F(k)));
      let kPresent: boolean;
      if (kind === 'Array') {
        kPresent = Q(yield* HasProperty(O, Pk));
      } else {
        kPresent = true;
      }
      if (kPresent) {
        const kValue = Q(yield* Get(O, Pk));
        accumulator = Q(yield* Call(callbackfn, Value.undefined, [accumulator, kValue, F(k), O]));
      }
      k -= 1;
    }
    return accumulator;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.reverse */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.reverse */
  function* ArrayProto_reverse(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    const middle = Math.floor(len / 2);
    let lower = 0;
    while (lower !== middle) {
      const upper = len - lower - 1;
      const upperP = X(ToString(F(upper)));
      const lowerP = X(ToString(F(lower)));
      const lowerExists = Q(yield* HasProperty(O, lowerP));
      let lowerValue;
      let upperValue;
      if (lowerExists) {
        lowerValue = Q(yield* Get(O, lowerP));
      }
      const upperExists = Q(yield* HasProperty(O, upperP));
      if (upperExists) {
        upperValue = Q(yield* Get(O, upperP));
      }
      if (lowerExists && upperExists) {
        Q(yield* Set(O, lowerP, upperValue as Value, true));
        Q(yield* Set(O, upperP, lowerValue as Value, true));
      } else if (!lowerExists && upperExists) {
        Q(yield* Set(O, lowerP, upperValue as Value, true));
        Q(yield* DeletePropertyOrThrow(O, upperP));
      } else if (lowerExists && !upperExists) {
        Q(yield* DeletePropertyOrThrow(O, lowerP));
        Q(yield* Set(O, upperP, lowerValue as Value, true));
      } else {
        // no further action is required
      }
      lower += 1;
    }
    return O;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.some */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.some */
  function* ArrayProto_some([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const O = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(O));
    if (!IsCallable(callbackfn)) {
      return Throw.TypeError('$1 is not a function', callbackfn);
    }
    let k = 0;
    while (k < len) {
      const Pk = X(ToString(F(k)));
      let kPresent: boolean;
      if (kind === 'Array') {
        kPresent = Q(yield* HasProperty(O, Pk));
      } else {
        kPresent = true;
      }
      if (kPresent) {
        const kValue = Q(yield* Get(O, Pk));
        const testResult = ToBoolean(Q(yield* Call(callbackfn, thisArg, [kValue, F(k), O])));
        if (testResult) {
          return Value.true;
        }
      }
      k += 1;
    }
    return Value.false;
  }

  /** https://tc39.es/ecma262/#sec-array.prototype.tolocalestring */
  /** https://tc39.es/ecma262/#sec-%typedarray%.prototype.tolocalestring */
  function* ArrayProto_toLocaleString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    Q(Validate?.(thisValue));
    const array = Q(ToObject(thisValue));
    const len = Q(yield* ToLength(array));
    const separator = ',';
    let R = '';
    let k = 0;
    while (k < len) {
      if (k > 0) {
        R = `${R}${separator}`;
      }
      const kStr = X(ToString(F(k)));
      const nextElement = Q(yield* Get(array, kStr));
      if (nextElement !== Value.undefined && nextElement !== Value.null) {
        const S = Q(yield* ToString(Q(yield* Invoke(nextElement, 'toLocaleString'))));
        R = `${R}${S}`;
      }
      k += 1;
    }
    return Value(R);
  }

  assignProps(realmRec, proto, [
    ['every', ArrayProto_every, 1],
    ['find', ArrayProto_find, 1],
    ['findIndex', ArrayProto_findIndex, 1],
    ['findLast', ArrayProto_findLast, 1],
    ['findLastIndex', ArrayProto_findLastIndex, 1],
    ['forEach', ArrayProto_forEach, 1],
    ['includes', ArrayProto_includes, 1],
    ['indexOf', ArrayProto_indexOf, 1],
    ['join', ArrayProto_join, 1],
    ['lastIndexOf', ArrayProto_lastIndexOf, 1],
    ['reduce', ArrayProto_reduce, 1],
    ['reduceRight', ArrayProto_reduceRight, 1],
    ['reverse', ArrayProto_reverse, 0],
    ['some', ArrayProto_some, 1],
    ['toLocaleString', ArrayProto_toLocaleString, 0],
  ]);
}
