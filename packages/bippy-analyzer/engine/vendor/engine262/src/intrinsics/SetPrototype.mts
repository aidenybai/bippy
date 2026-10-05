import {
  Descriptor,
  NumberValue,
  Value,
  wellKnownSymbols,
  ObjectValue,
  type Arguments,
  type FunctionCallContext,
  BooleanValue,
} from '../value.mts';
import {
  EnsureCompletion, NormalCompletion, Q, X, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { CreateSetIterator } from './SetIteratorPrototype.mts';
import type { SetObject } from './Set.mts';
import {
  surroundingAgent,
  Call,
  F,
  IsCallable,
  RequireInternalSlot,
  Get,
  ToNumber,
  ToIntegerOrInfinity,
  OrdinaryObjectCreate,
  SameValueZero, R,
  Realm,
  ToBoolean,
  GetIteratorFromMethod,
  CanonicalizeKeyedCollectionKey,
  IteratorStepValue,
  IteratorClose,
  Throw,
} from '#self';
import type {
  FunctionObject,
  Mutable,
  PlainEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#sec-set.prototype.add */
function SetProto_add([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue as SetObject;
  // 2. Perform ? RequireInternalSlot(S, [[SetData]]).
  Q(RequireInternalSlot(S, 'SetData'));
  // 3. Let entries be the List that is S.[[SetData]].
  const entries = S.SetData;
  // 4. For each e that is an element of entries, do
  for (const e of entries) {
    // a. For each e that is an element of entries, do
    if (e !== undefined && SameValueZero(e, value)) {
      // i. Return S.
      return S;
    }
  }
  // 5. If value is -0𝔽, set value to +0𝔽.
  if (value instanceof NumberValue && Object.is(R(value), -0)) {
    value = F(+0);
  }
  // 6. Append value as the last element of entries.
  Q(surroundingAgent.debugger_tryTouchDuringPreview(S));
  entries.push(value);
  // 7. Return S.
  return S;
}

/** https://tc39.es/ecma262/#sec-set.prototype.clear */
function SetProto_clear(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue as SetObject;
  // 2. Perform ? RequireInternalSlot(S, [[SetData]]).
  Q(RequireInternalSlot(S, 'SetData'));
  // 3. Let entries be the List that is S.[[SetData]].
  const entries = S.SetData;
  // 4. For each e that is an element of entries, do
  if (entries.length) {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(S));
  }
  for (let i = 0; i < entries.length; i += 1) {
    // a. Replace the element of entries whose value is e with an element whose value is empty.
    entries[i] = undefined;
  }
  // 5. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-set.prototype.delete */
function SetProto_delete([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue as SetObject;
  // 2. Perform ? RequireInternalSlot(S, [[SetData]]).
  Q(RequireInternalSlot(S, 'SetData'));
  // 3. Let entries be the List that is S.[[SetData]].
  const entries = S.SetData;
  // 4. For each e that is an element of entries, do
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    // a. If e is not empty and SameValueZero(e, value) is true, then
    if (e !== undefined && SameValueZero(e, value)) {
      // i. Replace the element of entries whose value is e with an element whose value is empty.
      Q(surroundingAgent.debugger_tryTouchDuringPreview(S));
      entries[i] = undefined;
      // ii. Return true.
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-set.prototype.difference */
function* SetProto_difference([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the this value.
  const O = thisValue;

  // 2. Perform ? RequireInternalSlot(O, [[SetData]]).
  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);

  // 3. Let otherRec be ? GetSetRecord(other).
  const otherRec = Q(yield* GetSetRecord(other));

  // 4. Let resultSetData be a copy of O.[[SetData]].
  const resultSetData = [...O.SetData];

  // 5. If SetDataSize(O.[[SetData]]) ≤ otherRec.[[Size]], then
  if (R(SetDataSize(O.SetData)) <= otherRec.Size) {
    /*
    a. Let thisSize be the number of elements in O.[[SetData]].
    b. Let index be 0.
    c. Repeat, while index < thisSize,
      i. Let e be resultSetData[index].
      ii. If e is not empty, then
        1. Let inOther be ToBoolean(? Call(otherRec.[[Has]], otherRec.[[SetObject]], « e »)).
        2. If inOther is true, then
          a. Set resultSetData[index] to empty.
      iii. Set index to index + 1.
    */
    const thisSize = O.SetData.length;
    let index = 0;
    while (index < thisSize) {
      const e = resultSetData[index];
      if (e !== undefined) {
        const inOther = ToBoolean(Q(yield* Call(otherRec.Has, otherRec.SetObject, [e])));
        if (inOther) {
          resultSetData[index] = undefined;
        }
      }
      index += 1;
    }
  } else {
    /*
    a. Let keysIter be ? GetIteratorFromMethod(otherRec.[[SetObject]], otherRec.[[Keys]]).
    b. Let next be not-started.
    c. Repeat, while next is not done,
      i. Set next to ? IteratorStepValue(keysIter).
      ii. If next is not done, then
        1. Set next to CanonicalizeKeyedCollectionKey(next).
        2. Let valueIndex be SetDataIndex(resultSetData, next).
        3. If valueIndex is not not-found, then
          a. Set resultSetData[valueIndex] to empty.
    */
    const keysIter = Q(yield* GetIteratorFromMethod(otherRec.SetObject, otherRec.Keys));
    let next: Value | 'done' | 'not-started' = 'not-started';
    while (next !== 'done') {
      next = Q(yield* IteratorStepValue(keysIter));
      if (next !== 'done') {
        next = CanonicalizeKeyedCollectionKey(next);
        const valueIndex = SetDataIndex(resultSetData, next);
        if (valueIndex !== 'not-found') {
          resultSetData[valueIndex] = undefined;
        }
      }
    }
  }

  /*
    7. Let result be OrdinaryObjectCreate(%Set.prototype%, « [[SetData]] »).
    8. Set result.[[SetData]] to resultSetData.
    9. Return result.
  */
  const result = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Set.prototype%'), ['SetData']) as Mutable<SetObject>;
  result.SetData = resultSetData;
  return result;
}

/** https://tc39.es/ecma262/#sec-set.prototype.entries */
function SetProto_entries(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue;
  // 2. Return ? CreateSetIterator(S, key+value).
  return Q(CreateSetIterator(S, 'key+value'));
}

/** https://tc39.es/ecma262/#sec-set.prototype.foreach */
function* SetProto_forEach([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let S be the this value.
  const S = thisValue as SetObject;
  // 2. Perform ? RequireInternalSlot(S, [[SetData]]).
  Q(RequireInternalSlot(S, 'SetData'));
  // 3. If IsCallable(callbackfn) is false, throw a TypeError exception
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  // 4. Let entries be the List that is S.[[SetData]].
  const entries = S.SetData;
  // 5. For each element _e_ of _entries_, do
  for (const e of entries) {
    // a. If e is not empty, then
    if (e !== undefined) {
      // i. Perform ? Call(callbackfn, thisArg, « e, e, S »).
      Q(yield* Call(callbackfn, thisArg, [e, e, S]));
    }
  }
  // 6. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-set.prototype.has */
function SetProto_has([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue as SetObject;
  // 2. Perform ? RequireInternalSlot(S, [[SetData]]).
  Q(RequireInternalSlot(S, 'SetData'));
  // 3. Let entries be the List that is S.[[SetData]].
  const entries = S.SetData;
  // 4. Let entries be the List that is S.[[SetData]].
  for (const e of entries) {
    // a. If e is not empty and SameValueZero(e, value) is true, return true.
    if (e !== undefined && SameValueZero(e, value)) {
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-get-set.prototype.size */
function SetProto_sizeGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue as SetObject;
  // 2. Perform ? RequireInternalSlot(S, [[SetData]]).
  Q(RequireInternalSlot(S, 'SetData'));
  // 3. Let entries be the List that is S.[[SetData]].
  const entries = S.SetData;

  return SetDataSize(entries);
}

/** https://tc39.es/ecma262/#sec-set.prototype.intersection */
function* SetProto_intersection([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the this value.
  const O = thisValue;

  // 2. Perform ? RequireInternalSlot(O, [[SetData]]).
  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);

  // 3. Let otherRec be ? GetSetRecord(other).
  const otherRec = Q(yield* GetSetRecord(other));

  // 4. Let resultSetData be a new empty List.
  const resultSetData: Value[] = [];

  if (R(SetDataSize(O.SetData)) <= otherRec.Size) {
    /*
    a. Let thisSize be the number of elements in O.[[SetData]].
    b. Let index be 0.
    c. Repeat, while index < thisSize,
      i. Let e be O.[[SetData]][index].
      ii. Set index to index + 1.
      iii. If e is not empty, then
        1. Let inOther be ToBoolean(? Call(otherRec.[[Has]], otherRec.[[SetObject]], « e »)).
        2. If inOther is true, then
          a. NOTE: It is possible for earlier calls to otherRec.[[Has]] to remove and re-add an element of O.[[SetData]], which can cause the same element to be visited twice during this iteration.
          b. If SetDataHas(resultSetData, e) is false, then
            i. Append e to resultSetData.
        3. NOTE: The number of elements in O.[[SetData]] may have increased during execution of otherRec.[[Has]].
        4. Set thisSize to the number of elements in O.[[SetData]].
    */
    let thisSize = O.SetData.length;
    let index = 0;
    while (index < thisSize) {
      const e: Value | undefined = O.SetData[index];
      index += 1;
      if (e !== undefined) {
        const inOther = ToBoolean(Q(yield* Call(otherRec.Has, otherRec.SetObject, [e])));
        if (inOther && !SetDataHas(resultSetData, e)) {
          resultSetData.push(e);
        }
      }
      thisSize = O.SetData.length;
    }
  } else {
    /*
      a. Let keysIter be ? GetIteratorFromMethod(otherRec.[[SetObject]], otherRec.[[Keys]]).
      b. Let next be not-started.
      c. Repeat, while next is not done,
        i. Set next to ? IteratorStepValue(keysIter).
        ii. If next is not done, then
          1. Set next to CanonicalizeKeyedCollectionKey(next).
          2. Let inThis be SetDataHas(O.[[SetData]], next).
          3. If inThis is true, then
            a. NOTE: Because other is an arbitrary object, it is possible for its "keys" iterator to produce the same value more than once.
            b. If SetDataHas(resultSetData, next) is false, then
              i. Append next to resultSetData.
    */
    const keysIter = Q(yield* GetIteratorFromMethod(otherRec.SetObject, otherRec.Keys));
    let next: Value | 'done' | 'not-started' = 'not-started';
    while (next !== 'done') {
      next = Q(yield* IteratorStepValue(keysIter));
      if (next !== 'done') {
        next = CanonicalizeKeyedCollectionKey(next);
        const inThis = SetDataHas(O.SetData, next);
        if (inThis && !SetDataHas(resultSetData, next)) {
          resultSetData.push(next);
        }
      }
    }
  }

  /*
    7. Let result be OrdinaryObjectCreate(%Set.prototype%, « [[SetData]] »).
    8. Set result.[[SetData]] to resultSetData.
    9. Return result.
  */
  const result = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Set.prototype%'), ['SetData']) as Mutable<SetObject>;
  result.SetData = resultSetData;
  return result;
}

/** https://tc39.es/ecma262/#sec-set.prototype.isdisjointfrom */
function* SetProto_isDisjointFrom([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<BooleanValue> {
  // 1. Let O be the this value.
  const O = thisValue;

  // 2. Perform ? RequireInternalSlot(O, [[SetData]]).
  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);

  // 3. Let otherRec be ? GetSetRecord(other).
  const otherRec = Q(yield* GetSetRecord(other));

  if (R(SetDataSize(O.SetData)) <= otherRec.Size) {
    /*
    a. Let thisSize be the number of elements in O.[[SetData]].
    b. Let index be 0.
    c. Repeat, while index < thisSize,
      i. Let e be O.[[SetData]][index].
      ii. Set index to index + 1.
      iii. If e is not empty, then
        1. Let inOther be ToBoolean(? Call(otherRec.[[Has]], otherRec.[[SetObject]], « e »)).
        2. If inOther is true, return false.
        3. NOTE: The number of elements in O.[[SetData]] may have increased during execution of otherRec.[[Has]].
        4. Set thisSize to the number of elements in O.[[SetData]].
    */
    let thisSize = O.SetData.length;
    let index = 0;
    while (index < thisSize) {
      const e = O.SetData[index];
      index += 1;
      if (e !== undefined) {
        const inOther = ToBoolean(Q(yield* Call(otherRec.Has, otherRec.SetObject, [e])));
        if (inOther) {
          return BooleanValue.false;
        }
        thisSize = O.SetData.length;
      }
    }
  } else {
    /*
    a. Let keysIter be ? GetIteratorFromMethod(otherRec.[[SetObject]], otherRec.[[Keys]]).
    b. Let next be not-started.
    c. Repeat, while next is not done,
      i. Set next to ? IteratorStepValue(keysIter).
      ii. If next is not done, then
        1. If SetDataHas(O.[[SetData]], next) is true, then
          a. Perform ? IteratorClose(keysIter, NormalCompletion(unused)).
          b. Return false.
    */
    const keysIter = Q(yield* GetIteratorFromMethod(otherRec.SetObject, otherRec.Keys));
    let next: Value | 'done' | 'not-started' = 'not-started';
    while (next !== 'done') {
      next = Q(yield* IteratorStepValue(keysIter));
      if (next !== 'done' && SetDataHas(O.SetData, next)) {
        Q(yield* IteratorClose(keysIter, NormalCompletion(undefined)));
        return Value.false;
      }
    }
  }

  return Value.true;
}

/** https://tc39.es/ecma262/#sec-set.prototype.issubsetof */
function* SetProto_isSubsetOf([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<BooleanValue> {
  const O = thisValue;

  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);

  const otherRec = Q(yield* GetSetRecord(other));
  if (SetDataSize(O.SetData).value > otherRec.Size) {
    return Value.false;
  }

  let thisSize = O.SetData.length;
  let index = 0;
  while (index < thisSize) {
    /*
    a. Let e be O.[[SetData]][index].
    b. Set index to index + 1.
    c. If e is not empty, then
      i. Let inOther be ToBoolean(? Call(otherRec.[[Has]], otherRec.[[SetObject]], « e »)).
      ii. If inOther is false, return false.
      iii. NOTE: The number of elements in O.[[SetData]] may have increased during execution of otherRec.[[Has]].
      iv. Set thisSize to the number of elements in O.[[SetData]].
    */
    const e = O.SetData[index];
    index += 1;
    if (e !== undefined) {
      const inOther = ToBoolean(Q(yield* Call(otherRec.Has, otherRec.SetObject, [e])));
      if (!inOther) {
        return Value.false;
      }
      thisSize = O.SetData.length;
    }
  }

  return Value.true;
}

/** https://tc39.es/ecma262/#sec-set.prototype.issupersetof */
function* SetProto_isSupersetOf([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<BooleanValue> {
  const O = thisValue;

  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);

  const otherRec = Q(yield* GetSetRecord(other));
  if (SetDataSize(O.SetData).value < otherRec.Size) {
    return Value.false;
  }

  const keysIter = Q(yield* GetIteratorFromMethod(otherRec.SetObject, otherRec.Keys));
  let next: Value | 'done' | 'not-started' = 'not-started';
  while (next !== 'done') {
    /*
    a. Set next to ? IteratorStepValue(keysIter).
    b. If next is not done, then
      i. If SetDataHas(O.[[SetData]], next) is false, then
        1. Perform ? IteratorClose(keysIter, NormalCompletion(unused)).
        2. Return false.
    */
    next = Q(yield* IteratorStepValue(keysIter));
    if (next !== 'done' && !SetDataHas(O.SetData, next)) {
      Q(yield* IteratorClose(keysIter, NormalCompletion(undefined)));
      return Value.false;
    }
  }

  return Value.true;
}

/** https://tc39.es/ecma262/#sec-set.prototype.symmetricdifference */
function* SetProto_symmetricDifference([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the this value.
  const O = thisValue;

  // 2. Perform ? RequireInternalSlot(O, [[SetData]]).
  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);

  // 3. Let otherRec be ? GetSetRecord(other).
  const otherRec = Q(yield* GetSetRecord(other));

  // 4. Let keysIter be ? GetIteratorFromMethod(otherRec.[[SetObject]], otherRec.[[Keys]]).
  const keysIter = Q(yield* GetIteratorFromMethod(otherRec.SetObject, otherRec.Keys));
  // 5. Let resultSetData be a copy of O.[[SetData]].
  const resultSetData = [...O.SetData];
  // 6. Let next be not-started.
  let next: Value | 'done' | 'not-started' = 'not-started';

  while (next !== 'done') {
    /*
    a. Set next to ? IteratorStepValue(keysIter).
    b. If next is not done, then
      i. Set next to CanonicalizeKeyedCollectionKey(next).
      ii. Let resultIndex be SetDataIndex(resultSetData, next).
      iii. If resultIndex is not-found, let alreadyInResult be false. Otherwise let alreadyInResult be true.
      iv. If SetDataHas(O.[[SetData]], next) is true, then
        1. If alreadyInResult is true, set resultSetData[resultIndex] to empty.
      v. Else,
        1. If alreadyInResult is false, append next to resultSetData.
    */
    next = Q(yield* IteratorStepValue(keysIter));
    if (next !== 'done') {
      next = CanonicalizeKeyedCollectionKey(next);
      const resultIndex: number | 'not-found' = SetDataIndex(resultSetData, next);
      if (SetDataHas(O.SetData, next) === true) {
        if (resultIndex !== 'not-found') {
          resultSetData[resultIndex] = undefined;
        }
      } else {
        if ((resultIndex === 'not-found')) {
          resultSetData.push(next);
        }
      }
    }
  }
  /*
  8. Let result be OrdinaryObjectCreate(%Set.prototype%, « [[SetData]] »).
  9. Set result.[[SetData]] to resultSetData.
  10. Return result.
  */

  const result = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Set.prototype%'), ['SetData']) as Mutable<SetObject>;
  result.SetData = resultSetData;
  return result;
}

/** https://tc39.es/ecma262/#sec-set.prototype.values */
function SetProto_values(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let S be the this value.
  const S = thisValue;
  // 2. Return ? CreateSetIterator(S, value).
  return Q(CreateSetIterator(S, 'value'));
}

/** https://tc39.es/ecma262/#sec-set.prototype.union */
function* SetProto_union([other = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireInternalSlot(O, 'SetData'));
  __ts_cast__<SetObject>(O);
  const otherRec = Q(yield* GetSetRecord(other));
  const keysIter = Q(yield* GetIteratorFromMethod(otherRec.SetObject, otherRec.Keys));
  // 5. Let resultSetData be a copy of O.[[SetData]].
  const resultSetData = [...O.SetData];
  let next: Value | 'not-started' | 'done' = 'not-started';
  while (next !== 'done') {
    next = Q(yield* IteratorStepValue(keysIter));
    if (next !== 'done') {
      next = CanonicalizeKeyedCollectionKey(next);
      if (!SetDataHas(resultSetData, next)) {
        resultSetData.push(next);
      }
    }
  }
  const result = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Set.prototype%'), ['SetData']) as Mutable<SetObject>;
  result.SetData = resultSetData;
  return result;
}

export function bootstrapSetPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['add', SetProto_add, 1],
    ['clear', SetProto_clear, 0],
    ['delete', SetProto_delete, 1],
    ['difference', SetProto_difference, 1],
    ['entries', SetProto_entries, 0],
    ['forEach', SetProto_forEach, 1],
    ['has', SetProto_has, 1],
    ['intersection', SetProto_intersection, 1],
    ['isDisjointFrom', SetProto_isDisjointFrom, 1],
    ['isSubsetOf', SetProto_isSubsetOf, 1],
    ['isSupersetOf', SetProto_isSupersetOf, 1],
    ['size', [SetProto_sizeGetter]],
    ['symmetricDifference', SetProto_symmetricDifference, 1],
    ['values', SetProto_values, 0],
    ['union', SetProto_union, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Set');

  const valuesFunc = X(proto.GetOwnProperty(Value('values'))) as Descriptor;
  X(proto.DefineOwnProperty(Value('keys'), valuesFunc));
  X(proto.DefineOwnProperty(wellKnownSymbols.iterator, valuesFunc));

  realmRec.Intrinsics['%Set.prototype%'] = proto;
}

interface SetRecord {
  readonly SetObject: ObjectValue;
  readonly Size: number;
  readonly Has: Value;
  readonly Keys: FunctionObject;
}

/** https://tc39.es/ecma262/#sec-getsetrecord */
function* GetSetRecord(obj: Value): PlainEvaluator<SetRecord> {
  // 1. If obj is not an Object, throw a TypeError exception.
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }

  // 2. Let rawSize be ? Get(obj, "size").
  const rawSize = Q(yield* Get(obj, 'size'));

  // 3. Let numSize be ? ToNumber(rawSize).
  // 4. NOTE: If rawSize is undefined, then numSize will be NaN.
  const numSize = Q(yield* ToNumber(rawSize));

  // 5. If numSize is NaN, throw a TypeError exception.
  if (numSize.isNaN()) {
    return Throw.TypeError('size property must not be undefined, as it will be NaN');
  }

  // 6. Let intSize be ! ToIntegerOrInfinity(numSize).
  const intSize = X(ToIntegerOrInfinity(numSize));

  // 7. If intSize < 0, throw a RangeError exception.
  if (intSize < 0) {
    return Throw.RangeError('size property must be a positive integer');
  }

  // 8. Let has be ? Get(obj, "has").
  const has = Q(yield* Get(obj, 'has'));

  // 9. If IsCallable(has) is false, throw a TypeError exception.
  if (!IsCallable(has)) {
    return Throw.TypeError('$1 is not a function', has);
  }

  // 10. Let keys be ? Get(obj, "keys").
  const keys = Q(yield* Get(obj, 'keys'));

  // 11. If IsCallable(keys) is false, throw a TypeError exception.
  if (!IsCallable(keys)) {
    return Throw.TypeError('$1 is not a function', keys);
  }

  // 12. Return a new Set Record { [[Set]]: obj, [[Size]]: intSize, [[Has]]: has, [[Keys]]: keys }.
  const setRecord: SetRecord = {
    SetObject: obj,
    Size: intSize,
    Has: has,
    Keys: keys,
  };

  return EnsureCompletion(setRecord);
}

/** https://tc39.es/ecma262/#sec-setdatahas */
function SetDataHas(resultSetData: (Value | undefined)[], value: Value): boolean {
  return SetDataIndex(resultSetData, value) !== 'not-found';
}

/** https://tc39.es/ecma262/#sec-setdataindex */
function SetDataIndex(setData: (Value | undefined)[], value: Value): number | 'not-found' {
  /*
  1. Set value to CanonicalizeKeyedCollectionKey(value).
  2. Let size be the number of elements in setData.
  3. Let index be 0.
  4. Repeat, while index < size,
    a. Let e be setData[index].
    b. If e is not empty and e is value, then
      i. Return index.
    c. Set index to index + 1.
  5. Return not-found.
  */
  value = CanonicalizeKeyedCollectionKey(value);
  const size = setData.length;
  let index = 0;
  while (index < size) {
    const e = setData[index];
    if (e !== undefined && SameValueZero(e, value)) {
      return index;
    }
    index += 1;
  }
  return 'not-found';
}

/** https://tc39.es/ecma262/#sec-setdatasize */
function SetDataSize(setData: (Value | undefined)[]) {
  let count = 0;
  for (const e of setData) {
    if (e !== undefined) {
      count += 1;
    }
  }
  return F(count);
}
