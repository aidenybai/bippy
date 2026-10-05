import {
  NumberValue,
  Value,
  wellKnownSymbols,
} from '../value.mts';
import { Q, X } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { CreateMapIterator } from './MapIteratorPrototype.mts';
import type { MapObject } from './Map.mts';
import {
  surroundingAgent,
  Call,
  CanonicalizeKeyedCollectionKey,
  F,
  IsCallable,
  RequireInternalSlot,
  SameValue, SameValueZero, Throw,
} from '#self';
import type {
  Arguments, Descriptor, ValueEvaluator, FunctionCallContext, Realm,
  ValueCompletion,
} from '#self';

/** https://tc39.es/ecma262/#sec-map.prototype.clear */
function MapProto_clear(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  if (entries.length) {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
  }
  for (const p of entries) {
    // a. Set p.[[Key]] to empty.
    p.Key = undefined;
    // b. Set p.[[Value]] to empty.
    p.Value = undefined;
  }
  // 5. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-map.prototype.delete */
function MapProto_delete([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entires be M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
      // i. Set p.[[Key]] to empty.
      p.Key = undefined;
      // ii. Set p.[[Value]] to empty.
      p.Value = undefined;
      // iii. Return true.
      return Value.true;
    }
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-map.prototype.entries */
function MapProto_entries(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue;
  // 2. Return ? CreateMapIterator(M, key+value);
  return Q(CreateMapIterator(M, 'key+value'));
}

/** https://tc39.es/ecma262/#sec-map.prototype.foreach */
function* MapProto_forEach([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. If IsCallable(callbackfn) is false, throw a TypeError exception.
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  // 4. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 5. For each Record { [[Key]], [[Value]] } e that is an element of entries, in original key insertion order, do
  for (const e of entries) {
    // a. If e.[[Key]] is not empty, then
    if (e.Key !== undefined) {
      // i. Perform ? Call(callbackfn, thisArg, « e.[[Value]], e.[[Key]], M »).
      Q(yield* Call(callbackfn, thisArg, [e.Value!, e.Key, M]));
    }
  }
  // 6. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-map.prototype.get */
function MapProto_get([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      // i. Return p.[[Value]].
      return p.Value!;
    }
  }
  // 5. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-map.prototype.getorinsert */
function MapProto_getOrInsert([key = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Set key to CanonicalizeKeyedCollectionKey(key).
  key = CanonicalizeKeyedCollectionKey(key);
  // 4. For each Record { [[Key]], [[Value]] } p of M.[[MapData]], do
  const entries = M.MapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      return p.Value!;
    }
  }
  // 5. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 6. Append p to M.[[MapData]].
  entries.push(p);
  // 7. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-map.prototype.getorinsertcomputed */
function* MapProto_getOrInsertComputed([key = Value.undefined, callbackfn = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. If IsCallable(callbackfn) is false, throw a TypeError exception.
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  // 4. Set key to CanonicalizeKeyedCollectionKey(key).
  key = CanonicalizeKeyedCollectionKey(key);
  // 5. For each Record { [[Key]], [[Value]] } p of M.[[MapData]], do
  const entries = M.MapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      return p.Value!;
    }
  }
  // 6. Let value be ? Call(callbackfn, undefined, « key »).
  const value = Q(yield* Call(callbackfn, Value.undefined, [key]));
  // 7. NOTE: The Map may have been modified during execution of callbackfn.
  // 8. For each Record { [[Key]], [[Value]] } p of M.[[MapData]], do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      // i. Set p.[[Value]] to value.
      p.Value = value;
      // ii. Return value.
      return value;
    }
  }
  // 9. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 10. Append p to M.[[MapData]].
  entries.push(p);
  // 11. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-map.prototype.has */
function MapProto_has([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, return true.
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-map.prototype.keys */
function MapProto_keys(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue;
  // 2. Return ? CreateMapIterator(M, key).
  return Q(CreateMapIterator(M, 'key'));
}

/** https://tc39.es/ecma262/#sec-map.prototype.set */
function MapProto_set([key = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      // i. Set p.[[Value]] to value.
      Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
      p.Value = value;
      // ii. Return M.
      return M;
    }
  }
  // 5. If key is -0𝔽, set key to +0𝔽.
  if (key instanceof NumberValue && Object.is(key.value, -0)) {
    key = F(+0);
  }
  // 6. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 7. Append p as the last element of entries.
  Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
  entries.push(p);
  // 8. Return M.
  return M;
}

/** https://tc39.es/ecma262/#sec-get-map.prototype.size */
function MapProto_sizeGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. Let count be 0.
  let count = 0;
  // 5. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty, set count to count + 1.
    if (p.Key !== undefined) {
      count += 1;
    }
  }
  // 6. Return 𝔽(count).
  return F(count);
}

/** https://tc39.es/ecma262/#sec-map.prototype.values */
function MapProto_values(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue;
  // 2. Return ? CreateMapIterator(M, value).
  return Q(CreateMapIterator(M, 'value'));
}

export function bootstrapMapPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['clear', MapProto_clear, 0],
    ['delete', MapProto_delete, 1],
    ['entries', MapProto_entries, 0],
    ['forEach', MapProto_forEach, 1],
    ['get', MapProto_get, 1],
    ['getOrInsert', MapProto_getOrInsert, 2],
    ['getOrInsertComputed', MapProto_getOrInsertComputed, 2],
    ['has', MapProto_has, 1],
    ['keys', MapProto_keys, 0],
    ['set', MapProto_set, 2],
    ['size', [MapProto_sizeGetter]],
    ['values', MapProto_values, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Map');

  const entriesFunc = X(proto.GetOwnProperty(Value('entries')));
  X(proto.DefineOwnProperty(wellKnownSymbols.iterator, entriesFunc as Descriptor));

  realmRec.Intrinsics['%Map.prototype%'] = proto;
}
