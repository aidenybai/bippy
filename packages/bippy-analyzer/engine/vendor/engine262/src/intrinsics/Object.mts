import {
  NullValue,
  ObjectValue,
  Value,
  type Arguments,
  type FunctionCallContext,
  type PropertyKeyValue,
  Descriptor,
  SymbolValue,
  JSStringValue,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { AddEntriesFromIterable } from './Map.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  surroundingAgent,
} from '#self';
import {
  Assert,
  CreateArrayFromList,
  CreateDataProperty,
  DefinePropertyOrThrow,
  CreateDataPropertyOrThrow,
  EnumerableOwnProperties,
  FromPropertyDescriptor,
  Get,
  HasOwnProperty,
  IsExtensible,
  OrdinaryObjectCreate,
  OrdinaryCreateFromConstructor,
  RequireObjectCoercible,
  SameValue,
  Set,
  SetIntegrityLevel,
  TestIntegrityLevel,
  ToObject,
  ToPropertyDescriptor,
  ToPropertyKey,
  CreateBuiltinFunction,
  Realm,
  Throw,
  type FunctionObject,
  GroupBy,
  type KeyedGroupRecord,
} from '#self';

/** https://tc39.es/ecma262/#sec-object-value */
function* ObjectConstructor([value = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  // 1. If NewTarget is neither undefined nor the active function, then
  if (NewTarget !== Value.undefined && NewTarget !== surroundingAgent.activeFunctionObject) {
    // a. Return ? OrdinaryCreateFromConstructor(NewTarget, "%Object.prototype%").
    return yield* OrdinaryCreateFromConstructor(NewTarget as FunctionObject, '%Object.prototype%');
  }
  // 2. If value is undefined or null, return OrdinaryObjectCreate(%Object.prototype%).
  if (value === Value.null || value === Value.undefined) {
    return OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  }
  // 3. Return ! ToObject(value).
  return X(ToObject(value));
}

/** https://tc39.es/ecma262/#sec-object.assign */
function* Object_assign([target = Value.undefined, ...sources]: Arguments): ValueEvaluator {
  // 1. Let to be ? ToObject(target).
  const to = Q(ToObject(target));
  // 2. If only one argument was passed, return to.
  if (sources.length === 0) {
    return to;
  }
  // 3. Let sources be the List of argument values starting with the second argument.
  // 4. For each element nextSource of sources, in ascending index order, do
  for (const nextSource of (sources as Arguments).values()) {
    // a. If nextSource is neither undefined nor null, then
    if (nextSource !== Value.undefined && nextSource !== Value.null) {
      // i. Let from be ! ToObject(nextSource).
      const from = X(ToObject(nextSource));
      // ii. Let keys be ? from.[[OwnPropertyKeys]]().
      const keys = Q(yield* from.OwnPropertyKeys());
      // iii. For each element nextKey of keys in List order, do
      for (const nextKey of keys) {
        // 1. Let desc be ? from.[[GetOwnProperty]](nextKey).
        const desc = Q(yield* from.GetOwnProperty(nextKey));
        // 2. If desc is not undefined and desc.[[Enumerable]] is true, then
        if (desc && desc.Enumerable) {
          // a. Let propValue be ? Get(from, nextKey).
          const propValue = Q(yield* Get(from, nextKey));
          // b. Perform ? Set(to, nextKey, propValue, true).
          Q(yield* Set(to, nextKey, propValue, true));
        }
      }
    }
  }
  // 5. Return to.
  return to;
}

/** https://tc39.es/ecma262/#sec-object.create */
function* Object_create([O = Value.undefined, Properties = Value.undefined]: Arguments) {
  // 1. If Type(O) is neither Object nor Null, throw a TypeError exception.
  if (!(O instanceof ObjectValue) && !(O instanceof NullValue)) {
    return Throw.TypeError('Object prototype must be an Object or null');
  }
  // 2. Let obj be OrdinaryObjectCreate(O).
  const obj = OrdinaryObjectCreate(O);
  // 3. If Properties is not undefined, then
  if (Properties !== Value.undefined) {
    // a. Return ? ObjectDefineProperties(obj, Properties).
    return Q(yield* ObjectDefineProperties(obj, Properties));
  }
  // 4. Return obj.
  return obj;
}

/** https://tc39.es/ecma262/#sec-object.defineproperties */
function* Object_defineProperties([O = Value.undefined, Properties = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Return ? ObjectDefineProperties(O, Properties).
  return Q(yield* ObjectDefineProperties(O, Properties));
}

/** https://tc39.es/ecma262/#sec-objectdefineproperties ObjectDefineProperties */
function* ObjectDefineProperties(O: Value, Properties: Value) {
  // 1. If Type(O) is not Object, throw a TypeError exception.
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', O);
  }
  // 2. Let props be ? ToObject(Properties).
  const props = Q(ToObject(Properties));
  // 3. Let keys be ? props.[[OwnPropertyKeys]]().
  const keys = Q(yield* props.OwnPropertyKeys());
  // 4. Let descriptors be a new empty List.
  const descriptors: [PropertyKeyValue, Descriptor][] = [];
  // 5. For each element nextKey of keys in List order, do
  for (const nextKey of keys) {
    // a. Let propDesc be ? props.[[GetOwnProperty]](nextKey).
    const propDesc = Q(yield* props.GetOwnProperty(nextKey));
    // b. If propDesc is not undefined and propDesc.[[Enumerable]] is true, then
    if (propDesc && propDesc.Enumerable) {
      // i. Let descObj be ? Get(props, nextKey).
      const descObj = Q(yield* Get(props, nextKey));
      // ii. Let desc be ? ToPropertyDescriptor(descObj).
      const desc = Q(yield* ToPropertyDescriptor(descObj));
      // iii. Append the pair (a two element List) consisting of nextKey and desc to the end of descriptors.
      descriptors.push([nextKey, desc]);
    }
  }
  // 6. For each pair from descriptors in list order, do
  for (const pair of descriptors) {
    // a. Let P be the first element of pair.
    const P = pair[0];
    // b. Let desc be the second element of pair.
    const desc = pair[1];
    // c. Perform ? DefinePropertyOrThrow(O, P, desc).
    Q(yield* DefinePropertyOrThrow(O, P, desc));
  }
  // 7. Return O.
  return O;
}

/** https://tc39.es/ecma262/#sec-object.defineproperty */
function* Object_defineProperty([O = Value.undefined, P = Value.undefined, Attributes = Value.undefined]: Arguments) {
  // 1. If Type(O) is not Object, throw a TypeError exception.
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', O);
  }
  // 2. Let key be ? ToPropertyKey(P).
  const key = Q(yield* ToPropertyKey(P));
  // 3. Let desc be ? ToPropertyDescriptor(Attributes).
  const desc = Q(yield* ToPropertyDescriptor(Attributes));
  // 4. Perform ? DefinePropertyOrThrow(O, key, desc).
  Q(yield* DefinePropertyOrThrow(O, key, desc));
  // 5. Return O.
  return O;
}

/** https://tc39.es/ecma262/#sec-object.entries */
function* Object_entries([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let nameList be ? EnumerableOwnPropertyNames(obj, key+value).
  const nameList = Q(yield* EnumerableOwnProperties(obj, 'key+value'));
  // 3. Return CreateArrayFromList(nameList).
  return CreateArrayFromList(nameList);
}

/** https://tc39.es/ecma262/#sec-object.freeze */
function* Object_freeze([O = Value.undefined]: Arguments) {
  // 1. If Type(O) is not Object, return O.
  if (!(O instanceof ObjectValue)) {
    return O;
  }
  // 2. Let status be ? SetIntegrityLevel(O, frozen).
  const status = Q(yield* SetIntegrityLevel(O, 'frozen'));
  // 3. If status is false, throw a TypeError exception.
  if (!status) {
    return Throw.TypeError('Unable to freeze object $1', O);
  }
  // 4. Return O.
  return O;
}

/** https://tc39.es/ecma262/#sec-object.fromentries */
function* Object_fromEntries([iterable = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Perform ? RequireObjectCoercible(iterable).
  Q(RequireObjectCoercible(iterable));
  // 2. Let obj be ! OrdinaryObjectCreate(%Object.prototype%).
  const obj = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%')));
  // 3. Assert: obj is an extensible ordinary object with no own properties.
  Assert(obj.Extensible && obj.properties.size === 0);
  // 4. Let closure be a new Abstract Closure with parameters (key, value) that captures obj and performs the following steps when called:
  function* closure([key = Value.undefined, value = Value.undefined]: Arguments): ValueEvaluator {
    // a. Let propertyKey be ? ToPropertyKey(key).
    const propertyKey = Q(yield* ToPropertyKey(key));
    // b. Perform ! CreateDataPropertyOrThrow(obj, propertyKey, value).
    X(CreateDataPropertyOrThrow(obj, propertyKey, value));
    // c. Return undefined.
    return Value.undefined;
  }
  // 5. Let adder be ! CreateBuiltinFunction(closure, 2, "", « »).
  const adder = X(CreateBuiltinFunction(closure, 2, Value(''), []));
  // 6. Return ? AddEntriesFromIterable(obj, iterable, adder).
  return Q(yield* AddEntriesFromIterable(obj, iterable, adder));
}

/** https://tc39.es/ecma262/#sec-object.getownpropertydescriptor */
function* Object_getOwnPropertyDescriptor([O = Value.undefined, P = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let key be ? ToPropertyKey(P).
  const key = Q(yield* ToPropertyKey(P));
  // 3. Let desc be ? obj.[[GetOwnProperty]](key).
  const desc = Q(yield* obj.GetOwnProperty(key));
  // 4. Return FromPropertyDescriptor(desc).
  return FromPropertyDescriptor(desc);
}

/** https://tc39.es/ecma262/#sec-object.getownpropertydescriptors */
function* Object_getOwnPropertyDescriptors([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let ownKeys be ? obj.[[OwnPropertyKeys]]().
  const ownKeys = Q(yield* obj.OwnPropertyKeys());
  // 3. Let descriptors be ! OrdinaryObjectCreate(%Object.prototype%).
  const descriptors = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%')));
  // 4. For each element key of ownKeys in List order, do
  for (const key of ownKeys) {
    // a. Let desc be ? obj.[[GetOwnProperty]](key).
    const desc = Q(yield* obj.GetOwnProperty(key));
    // b. Let descriptor be ! FromPropertyDescriptor(desc).
    const descriptor = X(FromPropertyDescriptor(desc));
    // c. If descriptor is not undefined, perform ! CreateDataPropertyOrThrow(descriptors, key, descriptor).
    if (descriptor !== Value.undefined) {
      X(CreateDataProperty(descriptors, key, descriptor));
    }
  }
  // 5. Return descriptors.
  return descriptors;
}

/** https://tc39.es/ecma262/#sec-getownpropertykeys */
function* GetOwnPropertyKeys(O: Value, type: 'String' | 'Symbol'): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let keys be ? obj.[[OwnPropertyKeys]]().
  const keys = Q(yield* obj.OwnPropertyKeys());
  // 3. Let nameList be a new empty List.
  const nameList: PropertyKeyValue[] = [];
  // 4. For each element nextKey of keys in List order, do
  keys.forEach((nextKey) => {
    // a. If nextKey is a Symbol and type is symbol, or if nextKey is a String and type is string, then
    if ((type === 'Symbol' && nextKey instanceof SymbolValue) || (type === 'String' && nextKey instanceof JSStringValue)) {
      // i. Append nextKey as the last element of nameList.
      nameList.push(nextKey);
    }
  });
  return CreateArrayFromList(nameList);
}

/** https://tc39.es/ecma262/#sec-object.getownpropertynames */
function* Object_getOwnPropertyNames([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Return ? GetOwnPropertyKeys(O, string).
  return Q(yield* GetOwnPropertyKeys(O, 'String'));
}

/** https://tc39.es/ecma262/#sec-object.getownpropertysymbols */
function* Object_getOwnPropertySymbols([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Return ? GetOwnPropertyKeys(O, symbol).
  return Q(yield* GetOwnPropertyKeys(O, 'Symbol'));
}

/** https://tc39.es/ecma262/#sec-object.getprototypeof */
function* Object_getPrototypeOf([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Return ? obj.[[GetPrototypeOf]]().
  return Q(yield* obj.GetPrototypeOf());
}

/** https://tc39.es/ecma262/#sec-object.groupby */
function* Object_groupBy([items = Value.undefined, callback = Value.undefined]: Arguments): ValueEvaluator {
  /*
  1. Let groups be ? GroupBy(items, callback, property).
  2. Let obj be OrdinaryObjectCreate(null).
  3. For each Record { [[Key]], [[Elements]] } g of groups, do
    a. Let elements be CreateArrayFromList(g.[[Elements]]).
    b. Perform ! CreateDataPropertyOrThrow(obj, g.[[Key]], elements).
  4. Return obj.
  */
  const groups: KeyedGroupRecord[] = Q(yield* GroupBy(items, callback, 'property'));
  const obj = OrdinaryObjectCreate(Value.null);
  for (const g of groups) {
    const elements = CreateArrayFromList(g.Elements);
    X(CreateDataPropertyOrThrow(obj, g.Key, elements));
  }
  return obj;
}

/** https://tc39.es/ecma262/#sec-object.hasown */
function* Object_hasOwn([O = Value.undefined, P = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let O be ? ToObject(this value).
  const key = Q(yield* ToPropertyKey(P));
  // 3. Return ? HasOwnProperty(obj, key).
  return Value(Q(yield* HasOwnProperty(obj, key)));
}

/** https://tc39.es/ecma262/#sec-object.is */
function Object_is([value1 = Value.undefined, value2 = Value.undefined]: Arguments) {
  // 1. Return SameValue(value1, value2).
  return Value(SameValue(value1, value2));
}

/** https://tc39.es/ecma262/#sec-object.isextensible */
function* Object_isExtensible([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. If Type(O) is not Object, return false.
  if (!(O instanceof ObjectValue)) {
    return Value.false;
  }
  // 2. Return ? IsExtensible(O).
  return Value(Q(yield* IsExtensible(O)));
}

/** https://tc39.es/ecma262/#sec-object.isfrozen */
function* Object_isFrozen([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. If Type(O) is not Object, return true.
  if (!(O instanceof ObjectValue)) {
    return Value.true;
  }
  // 2. Return ? TestIntegrityLevel(O, frozen).
  return Value(Q(yield* TestIntegrityLevel(O, 'frozen')));
}

/** https://tc39.es/ecma262/#sec-object.issealed */
function* Object_isSealed([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. If Type(O) is not Object, return true.
  if (!(O instanceof ObjectValue)) {
    return Value.true;
  }
  // 2. Return ? TestIntegrityLevel(O, sealed).
  return Value(Q(yield* TestIntegrityLevel(O, 'sealed')));
}

/** https://tc39.es/ecma262/#sec-object.keys */
function* Object_keys([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let nameList be ? EnumerableOwnPropertyNames(obj, key).
  const nameList = Q(yield* EnumerableOwnProperties(obj, 'key'));
  // 3. Return CreateArrayFromList(nameList).
  return CreateArrayFromList(nameList);
}

/** https://tc39.es/ecma262/#sec-object.preventextensions */
function* Object_preventExtensions([O = Value.undefined]: Arguments) {
  // 1. If Type(O) is not Object, return O.
  if (!(O instanceof ObjectValue)) {
    return O;
  }
  // 2. Let status be ? O.[[PreventExtensions]]().
  const status = Q(yield* O.PreventExtensions());
  // 3. If status is false, throw a TypeError exception.
  if (!status) {
    return Throw.TypeError('Unable to prevent extensions on object $1', O);
  }
  // 4. Return O.
  return O;
}

/** https://tc39.es/ecma262/#sec-object.seal */
function* Object_seal([O = Value.undefined]: Arguments) {
  // 1. If Type(O) is not Object, return O.
  if (!(O instanceof ObjectValue)) {
    return O;
  }
  // 2. Let status be ? SetIntegrityLevel(O, sealed).
  const status = Q(yield* SetIntegrityLevel(O, 'sealed'));
  // 3. If status is false, throw a TypeError exception.
  if (!status) {
    return Throw.TypeError('Unable to seal object $1', O);
  }
  // 4. Return O.
  return O;
}

/** https://tc39.es/ecma262/#sec-object.setprototypeof */
function* Object_setPrototypeOf([O = Value.undefined, proto = Value.undefined]: Arguments) {
  // 1. Perform ? RequireObjectCoercible(O).
  Q(RequireObjectCoercible(O));
  // 2. If Type(proto) is neither Object nor Null, throw a TypeError exception.
  if (!(proto instanceof ObjectValue) && !(proto instanceof NullValue)) {
    return Throw.TypeError('Object prototype must be an Object or null');
  }
  // 3. If Type(O) is not Object, return O.
  if (!(O instanceof ObjectValue)) {
    return O;
  }
  // 4. Let status be ? O.[[SetPrototypeOf]](proto).
  const status = Q(yield* O.SetPrototypeOf(proto));
  // 5. If status is false, throw a TypeError exception.
  if (!status) {
    return Throw.TypeError('Could not set prototype of object');
  }
  // 6. Return O.
  return O;
}

/** https://tc39.es/ecma262/#sec-object.values */
function* Object_values([O = Value.undefined]: Arguments): ValueEvaluator {
  // 1. Let obj be ? ToObject(O).
  const obj = Q(ToObject(O));
  // 2. Let nameList be ? EnumerableOwnPropertyNames(obj, value).
  const nameList = Q(yield* EnumerableOwnProperties(obj, 'value'));
  // 3. Return CreateArrayFromList(nameList).
  return CreateArrayFromList(nameList);
}

export function bootstrapObject(realmRec: Realm) {
  const objectConstructor = bootstrapConstructor(realmRec, ObjectConstructor, 'Object', 1, realmRec.Intrinsics['%Object.prototype%'], [
    ['assign', Object_assign, 2],
    ['create', Object_create, 2],
    ['defineProperties', Object_defineProperties, 2],
    ['defineProperty', Object_defineProperty, 3],
    ['entries', Object_entries, 1],
    ['freeze', Object_freeze, 1],
    ['fromEntries', Object_fromEntries, 1],
    ['getOwnPropertyDescriptor', Object_getOwnPropertyDescriptor, 2],
    ['getOwnPropertyDescriptors', Object_getOwnPropertyDescriptors, 1],
    ['getOwnPropertyNames', Object_getOwnPropertyNames, 1],
    ['getOwnPropertySymbols', Object_getOwnPropertySymbols, 1],
    ['getPrototypeOf', Object_getPrototypeOf, 1],
    ['groupBy', Object_groupBy, 2],
    ['hasOwn', Object_hasOwn, 2],
    ['is', Object_is, 2],
    ['isExtensible', Object_isExtensible, 1],
    ['isFrozen', Object_isFrozen, 1],
    ['isSealed', Object_isSealed, 1],
    ['keys', Object_keys, 1],
    ['preventExtensions', Object_preventExtensions, 1],
    ['seal', Object_seal, 1],
    ['setPrototypeOf', Object_setPrototypeOf, 2],
    ['values', Object_values, 1],
  ]);

  realmRec.Intrinsics['%Object%'] = objectConstructor;
}
