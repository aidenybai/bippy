import {
  Descriptor,
  ObjectValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  Q, X, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { clamp } from '../abstract-ops/math.mts';
import { assignProps } from './bootstrap.mts';
import { bootstrapArrayPrototypeShared, SortIndexedProperties } from './ArrayPrototypeShared.mts';
import { surroundingAgent } from '#self';
import {
  ArrayCreate,
  ArraySpeciesCreate,
  Assert,
  Call,
  CreateArrayIterator,
  CreateDataProperty,
  CreateDataPropertyOrThrow,
  DeletePropertyOrThrow,
  Get,
  HasProperty,
  IsArray,
  IsCallable,
  IsConcatSpreadable,
  Set,
  CompareArrayElements,
  LengthOfArrayLike,
  OrdinaryObjectCreate,
  ToBoolean,
  ToAbsoluteIndex,
  ToClampedIndex,
  ToIntegerOrInfinity,
  ToObject,
  ToString,
  Throw,
  F,
  type FunctionObject,
  Realm,
} from '#self';

/** https://tc39.es/ecma262/#sec-array.prototype.concat */
function* ArrayProto_concat(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const A = Q(yield* ArraySpeciesCreate(O, 0));
  let n = 0;
  const items = [O, ...args];
  while (items.length > 0) {
    const E = items.shift()!;
    const spreadable = Q(yield* IsConcatSpreadable(E));
    __ts_cast__<ObjectValue>(E);
    if (spreadable) {
      let k = 0;
      const len = Q(yield* LengthOfArrayLike(E));
      if (n + len > (2 ** 53) - 1) {
        return Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index');
      }
      while (k < len) {
        const P = X(ToString(F(k)));
        const exists = Q(yield* HasProperty(E, P));
        if (exists) {
          const subElement = Q(yield* Get(E, P));
          const nStr = X(ToString(F(n)));
          Q(yield* CreateDataPropertyOrThrow(A, nStr, subElement));
        }
        n += 1;
        k += 1;
      }
    } else {
      if (n >= (2 ** 53) - 1) {
        return Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index');
      }
      const nStr = X(ToString(F(n)));
      Q(yield* CreateDataPropertyOrThrow(A, nStr, E));
      n += 1;
    }
  }
  Q(yield* Set(A, 'length', F(n), true));
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.copywithin */
function* ArrayProto_copyWithin([target = Value.undefined, start = Value.undefined, end = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const length = Q(yield* LengthOfArrayLike(O));
  let to = Q(yield* ToClampedIndex(target, length));
  let from = Q(yield* ToClampedIndex(start, length));
  const final = end === Value.undefined ? length : Q(yield* ToClampedIndex(end, length));
  let count = Math.min(final - from, length - to);
  let direction;
  if (from < to && to < from + count) {
    direction = -1;
    from += count - 1;
    to += count - 1;
  } else {
    direction = 1;
  }
  while (count > 0) {
    const fromKey: string = X(ToString(F(from)));
    const toKey: string = X(ToString(F(to)));
    const fromPresent = Q(yield* HasProperty(O, fromKey));
    if (fromPresent) {
      const fromVal = Q(yield* Get(O, fromKey));
      Q(yield* Set(O, toKey, fromVal, true));
    } else {
      Q(yield* DeletePropertyOrThrow(O, toKey));
    }
    from += direction;
    to += direction;
    count -= 1;
  }
  return O;
}

/** https://tc39.es/ecma262/#sec-array.prototype.entries */
function ArrayProto_entries(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const O = Q(ToObject(thisValue));
  return CreateArrayIterator(O, 'key+value');
}

/** https://tc39.es/ecma262/#sec-array.prototype.fill */
function* ArrayProto_fill([value = Value.undefined, start = Value.undefined, end = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const length = Q(yield* LengthOfArrayLike(O));
  let k = Q(yield* ToClampedIndex(start, length));
  const final = end === Value.undefined ? length : Q(yield* ToClampedIndex(end, length));
  while (k < final) {
    const Pk: string = X(ToString(F(k)));
    Q(yield* Set(O, Pk, value, true));
    k += 1;
  }
  return O;
}

/** https://tc39.es/ecma262/#sec-array.prototype.filter */
function* ArrayProto_filter([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  const A = Q(yield* ArraySpeciesCreate(O, 0));
  let k = 0;
  let to = 0;
  while (k < len) {
    const Pk = X(ToString(F(k)));
    const kPresent = Q(yield* HasProperty(O, Pk));
    if (kPresent) {
      const kValue = Q(yield* Get(O, Pk));
      const selected = ToBoolean(Q(yield* Call(callbackfn, thisArg, [kValue, F(k), O])));
      if (selected) {
        Q(yield* CreateDataPropertyOrThrow(A, X(ToString(F(to))), kValue));
        to += 1;
      }
    }
    k += 1;
  }
  return A;
}

/** https://tc39.es/ecma262/#sec-flattenintoarray */
function* FlattenIntoArray(target: ObjectValue, source: ObjectValue, sourceLen: number, start: number, depth: number, mapperFunction?: FunctionObject, thisArg?: Value): PlainEvaluator<number> {
  Assert(target instanceof ObjectValue);
  Assert(source instanceof ObjectValue);
  Assert(sourceLen >= 0);
  Assert(start >= 0);
  // Assert: _depth_ is an integer Number, *+&infin;*, or *-&infin;*.
  // Assert(mapperFunction === undefined || (X(IsCallable(mapperFunction)) === Value.true && thisArg !== undefined && depth === 1));
  let targetIndex = start;
  let sourceIndex = 0;
  while (sourceIndex < sourceLen) {
    const P = X(ToString(F(sourceIndex)));
    const exists = Q(yield* HasProperty(source, P));
    if (exists) {
      let element = Q(yield* Get(source, P));
      if (mapperFunction) {
        Assert(!!thisArg);
        element = Q(yield* Call(mapperFunction, thisArg, [element, F(sourceIndex), source]));
      }
      let shouldFlatten = false;
      if (depth > 0) {
        shouldFlatten = Q(IsArray(element));
      }
      if (shouldFlatten) {
        const elementLen = Q(yield* LengthOfArrayLike(element as ObjectValue));
        targetIndex = Q(yield* FlattenIntoArray(target, element as ObjectValue, elementLen, targetIndex, depth - 1));
      } else {
        if (targetIndex >= (2 ** 53) - 1) {
          return Throw.TypeError('$1 is out of range', targetIndex);
        }
        Q(yield* CreateDataPropertyOrThrow(target, X(ToString(F(targetIndex))), element));
        targetIndex += 1;
      }
    }
    sourceIndex += 1;
  }
  return targetIndex;
}

/** https://tc39.es/ecma262/#sec-array.prototype.flat */
function* ArrayProto_flat([depth = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const sourceLen = Q(yield* LengthOfArrayLike(O));
  let depthNum = 1;
  if (depth !== Value.undefined) {
    depthNum = Q(yield* ToIntegerOrInfinity(depth));
  }
  const A = Q(yield* ArraySpeciesCreate(O, 0));
  Q(yield* FlattenIntoArray(A, O, sourceLen, 0, depthNum));
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.flatmap */
function* ArrayProto_flatMap([mapperFunction = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const sourceLen = Q(yield* LengthOfArrayLike(O));
  if (!IsCallable(mapperFunction)) {
    return Throw.TypeError('$1 is not a function', mapperFunction);
  }
  const A = Q(yield* ArraySpeciesCreate(O, 0));
  Q(yield* FlattenIntoArray(A, O, sourceLen, 0, 1, mapperFunction, thisArg));
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.keys */
function ArrayProto_keys(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const O = Q(ToObject(thisValue));
  return CreateArrayIterator(O, 'key');
}

/** https://tc39.es/ecma262/#sec-array.prototype.map */
function* ArrayProto_map([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  const A = Q(yield* ArraySpeciesCreate(O, len));
  let k = 0;
  while (k < len) {
    const Pk = X(ToString(F(k)));
    const kPresent = Q(yield* HasProperty(O, Pk));
    if (kPresent) {
      const kValue = Q(yield* Get(O, Pk));
      const mappedValue = Q(yield* Call(callbackfn, thisArg, [kValue, F(k), O]));
      Q(yield* CreateDataPropertyOrThrow(A, Pk, mappedValue));
    }
    k += 1;
  }
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.pop */
function* ArrayProto_pop(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  if (len === 0) {
  Q(yield* Set(O, 'length', F(+0), true));
    return Value.undefined;
  } else {
    const newLen = len - 1;
    const index = Q(yield* ToString(F(newLen)));
    const element = Q(yield* Get(O, index));
    Q(yield* DeletePropertyOrThrow(O, index));
  Q(yield* Set(O, 'length', F(newLen), true));
    return element;
  }
}

/** https://tc39.es/ecma262/#sec-array.prototype.push */
function* ArrayProto_push(_items: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const items = [..._items];
  const O = Q(ToObject(thisValue));
  let len = Q(yield* LengthOfArrayLike(O));
  const argCount = items.length;
  if (len + argCount > (2 ** 53) - 1) {
    return Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index');
  }
  while (items.length > 0) {
    const E = items.shift()!;
    Q(yield* Set(O, X(ToString(F(len))), E, true));
    len += 1;
  }
  Q(yield* Set(O, 'length', F(len), true));
  return F(len);
}

/** https://tc39.es/ecma262/#sec-array.prototype.shift */
function* ArrayProto_shift(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  if (len === 0) {
  Q(yield* Set(O, 'length', F(+0), true));
    return Value.undefined;
  }
  const first = Q(yield* Get(O, '0'));
  let k = 1;
  while (k < len) {
    const from = X(ToString(F(k)));
    const to = X(ToString(F(k - 1)));
    const fromPresent = Q(yield* HasProperty(O, from));
    if (fromPresent) {
      const fromVal = Q(yield* Get(O, from));
      Q(yield* Set(O, to, fromVal, true));
    } else {
      Q(yield* DeletePropertyOrThrow(O, to));
    }
    k += 1;
  }
  Q(yield* DeletePropertyOrThrow(O, X(ToString(F(len - 1)))));
  Q(yield* Set(O, 'length', F(len - 1), true));
  return first;
}

/** https://tc39.es/ecma262/#sec-array.prototype.slice */
function* ArrayProto_slice([start = Value.undefined, end = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const length = Q(yield* LengthOfArrayLike(O));
  let k = Q(yield* ToClampedIndex(start, length));
  const final = end === Value.undefined ? length : Q(yield* ToClampedIndex(end, length));
  const count = Math.max(final - k, 0);
  const A = Q(yield* ArraySpeciesCreate(O, count));
  let n = 0;
  while (k < final) {
    const Pk: string = X(ToString(F(k)));
    const kPresent = Q(yield* HasProperty(O, Pk));
    if (kPresent) {
      const kValue = Q(yield* Get(O, Pk));
      const nStr = X(ToString(F(n)));
      Q(yield* CreateDataPropertyOrThrow(A, nStr, kValue));
    }
    k += 1;
    n += 1;
  }
  Q(yield* Set(A, 'length', F(n), true));
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.sort */
function* ArrayProto_sort([comparator = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (comparator !== Value.undefined && !IsCallable(comparator)) {
    return Throw.TypeError('comparator ($1) is not a function', comparator);
  }
  const obj = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(obj));

  const SortCompare = function* SortCompare(x: Value, y: Value) {
    return yield* CompareArrayElements(x, y, comparator);
  };
  const sortedList = Q(yield* SortIndexedProperties(obj, len, SortCompare, 'skip-holes'));
  const itemCount = sortedList.length;
  let j = 0;
  while (j < itemCount) {
    Q(yield* Set(obj, X(ToString(F(j))), sortedList[j], true));
    j += 1;
  }
  while (j < len) {
    Q(yield* DeletePropertyOrThrow(obj, X(ToString(F(j)))));
    j += 1;
  }
  return obj;
}

/** https://tc39.es/ecma262/#sec-array.prototype.tosorted */
function* ArrayProto_toSorted([comparator = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  if (comparator !== Value.undefined && !IsCallable(comparator)) {
    return Throw.TypeError('$1 is not a function', comparator);
  }
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  const A = Q(ArrayCreate(len));
  const SortCompare = function* SortCompare(x: Value, y: Value) {
    return yield* CompareArrayElements(x, y, comparator);
  };
  const sortedList = Q(yield* SortIndexedProperties(O, len, SortCompare, 'read-through-holes'));
  let j = 0;
  while (j < len) {
    X(CreateDataPropertyOrThrow(A, X(ToString(F(j))), sortedList[j]));
    j += 1;
  }
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.splice */
function* ArrayProto_splice(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const [start = Value.undefined, deleteCount = Value.undefined, ...items] = args;
  const obj = Q(ToObject(thisValue));
  const length = Q(yield* LengthOfArrayLike(obj));
  const actualStart = Q(yield* ToClampedIndex(start, length));
  let insertCount;
  let actualDeleteCount;
  if (args.length === 0) {
    insertCount = 0;
    actualDeleteCount = 0;
  } else if (args.length === 1) {
    insertCount = 0;
    actualDeleteCount = length - actualStart;
    Assert(actualDeleteCount >= 0);
  } else {
    insertCount = args.length - 2;
    const dc = Q(yield* ToIntegerOrInfinity(deleteCount));
    actualDeleteCount = clamp(0, dc, length - actualStart);
  }
  if (length + insertCount - actualDeleteCount > (2 ** 53) - 1) {
    return Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index');
  }
  const A = Q(yield* ArraySpeciesCreate(obj, actualDeleteCount));
  let k = 0;
  while (k < actualDeleteCount) {
    const from = X(ToString(F(actualStart + k)));
    const fromPresent = Q(yield* HasProperty(obj, from));
    if (fromPresent) {
      const fromValue = Q(yield* Get(obj, from));
      Q(yield* CreateDataPropertyOrThrow(A, X(ToString(F(k))), fromValue));
    }
    k += 1;
  }
  Q(yield* Set(A, 'length', F(actualDeleteCount), true));
  const itemCount = items.length;
  if (itemCount < actualDeleteCount) {
    k = actualStart;
    while (k < length - actualDeleteCount) {
      const from = X(ToString(F(k + actualDeleteCount)));
      const to = X(ToString(F(k + itemCount)));
      const fromPresent = Q(yield* HasProperty(obj, from));
      if (fromPresent) {
        const fromValue = Q(yield* Get(obj, from));
        Q(yield* Set(obj, to, fromValue, true));
      } else {
        Q(yield* DeletePropertyOrThrow(obj, to));
      }
      k += 1;
    }
    k = length;
    while (k > length - actualDeleteCount + itemCount) {
      Q(yield* DeletePropertyOrThrow(obj, X(ToString(F(k - 1)))));
      k -= 1;
    }
  } else if (itemCount > actualDeleteCount) {
    k = length - actualDeleteCount;
    while (k > actualStart) {
      const from = X(ToString(F(k + actualDeleteCount - 1)));
      const to = X(ToString(F(k + itemCount - 1)));
      const fromPresent = Q(yield* HasProperty(obj, from));
      if (fromPresent) {
        const fromValue = Q(yield* Get(obj, from));
        Q(yield* Set(obj, to, fromValue, true));
      } else {
        Q(yield* DeletePropertyOrThrow(obj, to));
      }
      k -= 1;
    }
  }
  k = actualStart;
  while (items.length > 0) {
    const E = items.shift()!;
    Q(yield* Set(obj, X(ToString(F(k))), E, true));
    k += 1;
  }
  Q(yield* Set(obj, 'length', F(length - actualDeleteCount + itemCount), true));
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.tospliced */
function* ArrayProto_toSpliced(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const [start = Value.undefined, skipCount = Value.undefined, ...items] = args as Value[];
  const obj = Q(ToObject(thisValue));
  const length = Q(yield* LengthOfArrayLike(obj));
  const actualStart = Q(yield* ToClampedIndex(start, length));
  const maxSkipCount = length - actualStart;
  const insertCount = items.length;
  let actualSkipCount;
  if (args[0] === undefined) {
    actualSkipCount = 0;
  } else if (args[1] === undefined) {
    actualSkipCount = maxSkipCount;
  } else {
    actualSkipCount = clamp(0, Q(yield* ToIntegerOrInfinity(skipCount)), maxSkipCount);
  }
  const newLen = length - actualSkipCount + insertCount;
  if (newLen > (2 ** 53) - 1) {
    return Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index');
  }
  Assert(newLen >= 0);
  const A = Q(ArrayCreate(newLen));
  let i = 0;
  let r = actualStart + actualSkipCount;
  while (i < actualStart) {
    const Pi = X(ToString(F(i)));
    const iValue = Q(yield* Get(obj, Pi));
    X(CreateDataPropertyOrThrow(A, Pi, iValue));
    i += 1;
  }
  for (const E of items) {
    const Pi = X(ToString(F(i)));
    X(CreateDataPropertyOrThrow(A, Pi, E));
    i += 1;
  }
  while (i < newLen) {
    const Pi = X(ToString(F(i)));
    const from = X(ToString(F(r)));
    const fromValue = Q(yield* Get(obj, from));
    X(CreateDataPropertyOrThrow(A, Pi, fromValue));
    i += 1;
    r += 1;
  }
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.with */
function* ArrayProto_with([index = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const obj = Q(ToObject(thisValue));
  const length = Q(yield* LengthOfArrayLike(obj));
  const actualIndex = Q(yield* ToAbsoluteIndex(index, length));
  if (actualIndex < 0 || actualIndex >= length) {
    return Throw.RangeError('$1 is out of range', index);
  }
  const A = Q(ArrayCreate(length));
  let k = 0;
  while (k < length) {
    const Pk = X(ToString(F(k)));
    let fromValue;
    if (k === actualIndex) {
      fromValue = value;
    } else {
      fromValue = Q(yield* Get(obj, Pk));
    }
    X(CreateDataPropertyOrThrow(A, Pk, fromValue));
    k += 1;
  }
  return A;
}

/** https://tc39.es/ecma262/#sec-array.prototype.tostring */
function* ArrayProto_toString(_a: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const array = Q(ToObject(thisValue));
  let func = Q(yield* Get(array, 'join'));
  if (!IsCallable(func)) {
    func = surroundingAgent.intrinsic('%Object.prototype.toString%');
  }
  return Q(yield* Call(func, array));
}

/** https://tc39.es/ecma262/#sec-array.prototype.unshift */
function* ArrayProto_unshift(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  const argCount = args.length;
  if (argCount > 0) {
    if (len + argCount > (2 ** 53) - 1) {
      return Throw.TypeError('Cannot make length of array-like object surpass the bounds of an integer index');
    }
    let k = len;
    while (k > 0) {
      const from = X(ToString(F(k - 1)));
      const to = X(ToString(F(k + argCount - 1)));
      const fromPresent = Q(yield* HasProperty(O, from));
      if (fromPresent) {
        const fromValue = Q(yield* Get(O, from));
        Q(yield* Set(O, to, fromValue, true));
      } else {
        Q(yield* DeletePropertyOrThrow(O, to));
      }
      k -= 1;
    }
    let j = 0;
    const items = [...args];
    while (items.length !== 0) {
      const E = items.shift()!;
      const jStr = X(ToString(F(j)));
      Q(yield* Set(O, jStr, E, true));
      j += 1;
    }
  }
  Q(yield* Set(O, 'length', F(len + argCount), true));
  return F(len + argCount);
}

/** https://tc39.es/ecma262/#sec-array.prototype.values */
function ArrayProto_values(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const O = Q(ToObject(thisValue));
  return CreateArrayIterator(O, 'value');
}

/** https://tc39.es/ecma262/#sec-array.prototype.at */
function* ArrayProto_at([index = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be ? ToObject(this value).
  const O = Q(ToObject(thisValue));
  // 2. Let len be ? LengthOfArrayLike(O).
  const length = Q(yield* LengthOfArrayLike(O));
  // 3. Let relativeIndex be ? ToIntegerOrInfinity(index).
  const k = Q(yield* ToAbsoluteIndex(index, length));
  // 6. If k < 0 or k ≥ len, then return undefined.
  if (k < 0 || k >= length) {
    return Value.undefined;
  }
  // 7. Return ? Get(O, ! ToString(k)).
  return Q(yield* Get(O, X(ToString(F(k)))));
}

/** https://tc39.es/ecma262/#sec-array.prototype.toreversed */
function* ArrayProto_toReversed(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = Q(ToObject(thisValue));
  const len = Q(yield* LengthOfArrayLike(O));
  const A = Q(ArrayCreate(len));
  let k = 0;
  while (k < len) {
    const from = X(ToString(F(len - 1 - k)));
    const Pk = X(ToString(F(k)));
    const fromValue = Q(yield* Get(O, from));
    X(CreateDataPropertyOrThrow(A, Pk, fromValue));
    k += 1;
  }
  return A;
}

export function bootstrapArrayPrototype(realmRec: Realm) {
  const proto = X(ArrayCreate(0, realmRec.Intrinsics['%Object.prototype%']));

  assignProps(realmRec, proto, [
    ['concat', ArrayProto_concat, 1],
    ['copyWithin', ArrayProto_copyWithin, 2],
    ['entries', ArrayProto_entries, 0],
    ['fill', ArrayProto_fill, 1],
    ['filter', ArrayProto_filter, 1],
    ['flat', ArrayProto_flat, 0],
    ['flatMap', ArrayProto_flatMap, 1],
    ['at', ArrayProto_at, 1],
    ['keys', ArrayProto_keys, 0],
    ['map', ArrayProto_map, 1],
    ['pop', ArrayProto_pop, 0],
    ['push', ArrayProto_push, 1],
    ['shift', ArrayProto_shift, 0],
    ['slice', ArrayProto_slice, 2],
    ['sort', ArrayProto_sort, 1],
    ['toSorted', ArrayProto_toSorted, 1],
    ['splice', ArrayProto_splice, 2],
    ['toSpliced', ArrayProto_toSpliced, 2],
    ['toString', ArrayProto_toString, 0],
    ['unshift', ArrayProto_unshift, 1],
    ['values', ArrayProto_values, 0],
    ['with', ArrayProto_with, 2],
    ['toReversed', ArrayProto_toReversed, 0],
  ]);

  bootstrapArrayPrototypeShared(realmRec, proto, 'Array');

  X(proto.DefineOwnProperty(wellKnownSymbols.iterator, X(proto.GetOwnProperty(Value('values'))) as Descriptor));

  {
    const unscopableList = OrdinaryObjectCreate(Value.null);
    Assert(X(CreateDataProperty(unscopableList, 'at', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'copyWithin', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'entries', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'fill', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'find', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'findIndex', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'findLast', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'findLastIndex', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'flat', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'flatMap', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'includes', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'keys', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'toReversed', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'toSorted', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'toSpliced', Value.true)));
    Assert(X(CreateDataProperty(unscopableList, 'values', Value.true)));
    X(proto.DefineOwnProperty(wellKnownSymbols.unscopables, Descriptor({
      Value: unscopableList,
      Writable: false,
      Enumerable: false,
      Configurable: true,
    })));
  }

  // Used in `arguments` objects.
  realmRec.Intrinsics['%Array.prototype.values%'] = X(Get(proto, 'values')) as FunctionObject;

  realmRec.Intrinsics['%Array.prototype%'] = proto;
}
