import {
  Descriptor,
  JSStringValue,
  Value,
  ObjectValue,
  wellKnownSymbols,
  type PropertyKeyValue,
  UndefinedValue,
  NullValue,
  type Arguments,
} from '../value.mts';
import { InstanceofOperator } from '../runtime-semantics/all.mts';
import { markCallContinuation } from '../../../../src/execution-machine.ts';
import {
  EnsureCompletion,
  Q, X,
  type PlainCompletion,
} from '../completion.mts';
import { __ts_cast__, isArray } from '../utils/language.mts';
import { isBoundFunctionObject } from '../intrinsics/FunctionPrototype.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  surroundingAgent,
  type OrdinaryObject,
} from '#self';
import {
  ArrayCreate,
  Assert,
  IsAccessorDescriptor,
  IsCallable,
  IsConstructor,
  IsDataDescriptor,
  IsExtensible,
  IsPropertyKey,
  SameValue,
  ToLength,
  ToObject,
  ToString,
  isProxyExoticObject,
  F as toNumberValue, R, type FunctionObject, Realm,
  RequireObjectCoercible,
  GetIterator,
  IteratorClose,
  IteratorStepValue,
  F,
  IfAbruptCloseIterator,
  type ValueCompletion,
  ToPropertyKey,
  CanonicalizeKeyedCollectionKey,
  Throw,
  OrdinaryObjectCreate,
} from '#self';


// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-operations-on-objects */

/** https://tc39.es/ecma262/#sec-makebasicobject */
export function MakeBasicObject<const T extends string>(internalSlotsList: readonly T[]) {
  // 1.  Assert: internalSlotsList is a List of internal slot names.
  Assert(isArray(internalSlotsList));
  // 2.  Let obj be a newly created object with an internal slot for each name in internalSlotsList.
  // 3.  Set obj's essential internal methods to the default ordinary object definitions specified in 9.1.
  const obj = new ObjectValue(internalSlotsList) as ObjectValue & Record<T, unknown>;
  Object.assign(obj, internalSlotsList.reduce((extraFields, currentField) => {
    extraFields[currentField] = undefined;
    return extraFields;
  }, {} as Record<T, unknown>));
  // 4.  Assert: If the caller will not be overriding both obj's [[GetPrototypeOf]] and [[SetPrototypeOf]] essential internal methods, then internalSlotsList contains [[Prototype]].
  // 5.  Assert: If the caller will not be overriding all of obj's [[SetPrototypeOf]], [[IsExtensible]], and [[PreventExtensions]] essential internal methods, then internalSlotsList contains [[Extensible]].
  // 6.  If internalSlotsList contains [[Extensible]], then set obj.[[Extensible]] to true.
  if ((internalSlotsList as readonly string[]).includes('Extensible')) {
    (obj as OrdinaryObject).Extensible = true;
  }
  // 7.  Return obj.
  return obj;
}

/** https://tc39.es/ecma262/#sec-get-o-p */
export function* Get(O: ObjectValue, P: PropertyKeyValue | string): ValueEvaluator {
  Assert(O instanceof ObjectValue);
  if (P instanceof JSStringValue) P = P.stringValue();
  return Q(yield* O.Get(P, O));
}

/** https://tc39.es/ecma262/#sec-getv */
export function* GetV(V: Value, P: PropertyKeyValue | string): ValueEvaluator {
  if (P instanceof JSStringValue) P = P.stringValue();
  const O = Q(ToObject(V));
  return Q(yield* O.Get(P, V));
}

/** https://tc39.es/ecma262/#sec-set-o-p-v-throw */
export function* Set(O: ObjectValue, P: PropertyKeyValue | string, V: Value, throws: boolean) {
  Assert(O instanceof ObjectValue);
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(typeof throws === 'boolean');
  const success = Q(yield* O.Set(P, V, O));
  if (!success && throws) {
    return Throw.TypeError('Cannot set property $1 on $2', P, O);
  }
  return success;
}

/** https://tc39.es/ecma262/#sec-createdataproperty */
export function* CreateDataProperty(O: ObjectValue, P: PropertyKeyValue | string, V: Value): PlainEvaluator<boolean> {
  Assert(O instanceof ObjectValue);
  if (P instanceof JSStringValue) P = P.stringValue();

  const newDesc = Descriptor({
    Value: V,
    Writable: true,
    Enumerable: true,
    Configurable: true,
  });
  return Q(yield* O.DefineOwnProperty(P, newDesc));
}

/** https://tc39.es/ecma262/#sec-createmethodproperty */
export function* CreateMethodProperty(O: ObjectValue, P: PropertyKeyValue | string, V: Value): PlainEvaluator<boolean> {
  Assert(O instanceof ObjectValue);
  if (P instanceof JSStringValue) P = P.stringValue();

  const newDesc = Descriptor({
    Value: V,
    Writable: true,
    Enumerable: false,
    Configurable: true,
  });
  return Q(yield* O.DefineOwnProperty(P, newDesc));
}

/** https://tc39.es/ecma262/#sec-createdatapropertyorthrow */
export function* CreateDataPropertyOrThrow(O: ObjectValue, P: PropertyKeyValue | string, V: Value) {
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(O instanceof ObjectValue);
  const success = Q(yield* CreateDataProperty(O, P, V));
  if (!success) {
    return Throw.TypeError('Cannot define property $1', P);
  }
  return success;
}

export function CreateNonEnumerableDataPropertyOrThrow(O: ObjectValue, P: PropertyKeyValue | string, V: Value) {
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(O instanceof ObjectValue);
  const newDesc = Descriptor({
    Value: V,
    Writable: true,
    Enumerable: false,
    Configurable: true,
  });
  X(DefinePropertyOrThrow(O, P, newDesc));
}

/** https://tc39.es/ecma262/#sec-definepropertyorthrow */
export function* DefinePropertyOrThrow(O: ObjectValue, P: PropertyKeyValue | string, desc: Descriptor) {
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(O instanceof ObjectValue);
  const success = Q(yield* O.DefineOwnProperty(P, desc));
  if (!success) {
    return Throw.TypeError('Cannot define property $1', P);
  }
  return success;
}

/** https://tc39.es/ecma262/#sec-deletepropertyorthrow */
export function* DeletePropertyOrThrow(O: ObjectValue, P: PropertyKeyValue | string) {
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(O instanceof ObjectValue);
  const success = Q(yield* O.Delete(P));
  if (!success) {
    return Throw.TypeError('Cannot delete property $1', P);
  }
  return success;
}

/** https://tc39.es/ecma262/#sec-getmethod */
export function* GetMethod(V: Value, P: PropertyKeyValue | string): ValueEvaluator<UndefinedValue | FunctionObject> {
  if (P instanceof JSStringValue) P = P.stringValue();
  const func = Q(yield* GetV(V, P));
  if (func === Value.null || func === Value.undefined) {
    return Value.undefined;
  }
  if (!IsCallable(func)) {
    return Throw.TypeError('$1 is not a function', func);
  }
  return func;
}

/** https://tc39.es/ecma262/#sec-hasproperty */
export function* HasProperty(O: ObjectValue, P: PropertyKeyValue | string): PlainEvaluator<boolean> {
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(O instanceof ObjectValue);
  return Q(yield* O.HasProperty(P));
}

/** https://tc39.es/ecma262/#sec-hasownproperty */
export function* HasOwnProperty(O: ObjectValue, P: PropertyKeyValue | string): PlainEvaluator<boolean> {
  if (P instanceof JSStringValue) P = P.stringValue();
  Assert(O instanceof ObjectValue);
  const desc = Q(yield* O.GetOwnProperty(P));
  if (!desc) {
    return false;
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-call */
export function* Call(F: Value, V: Value, argumentsList: Arguments = []): ValueEvaluator {
  markCallContinuation();
  Assert(argumentsList.every((a) => a instanceof Value));

  if (!IsCallable(F)) {
    return Throw.TypeError('$1 is not a function', F);
  }

  if (surroundingAgent.breakpointsByFunction.has(F)) {
    const resumption = yield { suspend: 'debugger' };
    Assert(resumption.resume === 'debugger');
  }

  return EnsureCompletion(Q(yield* F.Call(V, argumentsList)));
}

/** https://tc39.es/ecma262/#sec-construct */
export function* Construct(F: FunctionObject, argumentsList: Arguments = [], newTarget?: FunctionObject | UndefinedValue): ValueEvaluator<ObjectValue> {
  if (!newTarget) {
    newTarget = F;
  }
  Assert(IsConstructor(F));
  Assert(IsConstructor(newTarget));
  return Q(yield* F.Construct(argumentsList, newTarget));
}

/** https://tc39.es/ecma262/#sec-setintegritylevel */
export function* SetIntegrityLevel(O: ObjectValue, level: 'sealed' | 'frozen'): PlainEvaluator<boolean> {
  Assert(O instanceof ObjectValue);
  Assert(level === 'sealed' || level === 'frozen');
  const status = Q(yield* O.PreventExtensions());
  if (!status) {
    return false;
  }
  const keys = Q(yield* O.OwnPropertyKeys());
  if (level === 'sealed') {
    for (const k of keys) {
      Q(yield* DefinePropertyOrThrow(O, k, Descriptor({ Configurable: false })));
    }
  } else if (level === 'frozen') {
    for (const k of keys) {
      const currentDesc = Q(yield* O.GetOwnProperty(k));
      if (currentDesc) {
        let desc;
        if (IsAccessorDescriptor(currentDesc) === true) {
          desc = Descriptor({ Configurable: false });
        } else {
          desc = Descriptor({ Configurable: false, Writable: false });
        }
        Q(yield* DefinePropertyOrThrow(O, k, desc));
      }
    }
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-testintegritylevel */
export function* TestIntegrityLevel(O: ObjectValue, level: 'sealed' | 'frozen'): PlainEvaluator<boolean> {
  Assert(O instanceof ObjectValue);
  Assert(level === 'sealed' || level === 'frozen');
  const extensible = Q(yield* IsExtensible(O));
  if (extensible) {
    return false;
  }
  const keys = Q(yield* O.OwnPropertyKeys());
  for (const k of keys) {
    const currentDesc = Q(yield* O.GetOwnProperty(k));
    if (currentDesc) {
      if (currentDesc.Configurable) {
        return false;
      }
      if (level === 'frozen' && IsDataDescriptor(currentDesc)) {
        if (currentDesc.Writable) {
          return false;
        }
      }
    }
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-createarrayfromlist */
export function CreateArrayFromList(elements: Arguments) {
  // 1. Assert: elements is a List whose elements are all ECMAScript language values.
  Assert(elements.every((e) => e instanceof Value));
  // 2. Let array be ! ArrayCreate(0).
  const array = X(ArrayCreate(0));
  // 3. Let n be 0.
  let n = 0;
  // 4. For each element e of elements, do
  for (const e of elements) {
    // a. Perform ! CreateDataPropertyOrThrow(array, ! ToString(𝔽(n)), e).
    X(CreateDataPropertyOrThrow(array, X(ToString(toNumberValue(n))), e));
    // b. Set n to n + 1.
    n += 1;
  }
  // 5. Return array.
  return array;
}

/** https://tc39.es/ecma262/#sec-lengthofarraylike */
export function* LengthOfArrayLike(obj: ObjectValue): PlainEvaluator<number> {
  // 1. Assert: Type(obj) is Object.
  Assert(obj instanceof ObjectValue);
  // 2. Return ℝ(? ToLength(? Get(obj, "length"))).
  return R(Q(yield* ToLength(Q(yield* Get(obj, 'length')))));
}

/** https://tc39.es/ecma262/#sec-createlistfromarraylike */
export function CreateListFromArrayLike(obj: Value, validElementTypes?: undefined | 'all'): PlainEvaluator<Value[]>
export function CreateListFromArrayLike(obj: Value, validElementTypes: 'property-key'): PlainEvaluator<PropertyKeyValue[]>
export function* CreateListFromArrayLike(obj: Value, validElementTypes: 'all' | 'property-key' = 'all'): PlainEvaluator<Value[]> {
  // 2. If Type(obj) is not Object, throw a TypeError exception.
  if (!(obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', obj);
  }
  // 3. Let len be ? LengthOfArrayLike(obj).
  const len = Q(yield* LengthOfArrayLike(obj));
  // 4. Let list be a new empty List.
  const list = [];
  // 5. Let index be 0.
  let index = 0;
  // 6. Repeat, while index < len,
  while (index < len) {
    // a. Let indexName be ! ToString(𝔽(index)).
    const indexName = X(ToString(toNumberValue(index)));
    // b. Let next be ? Get(obj, indexName).
    const next = Q(yield* Get(obj, indexName));
    // c. If Type(next) is not an element of elementTypes, throw a TypeError exception.
    if (validElementTypes === 'property-key' && !IsPropertyKey(next)) {
      return Throw.TypeError('$1 is not a valid property name', next);
    }
    // d. Append next as the last element of list.
    list.push(next);
    // e. Set index to index + 1.
    index += 1;
  }
  // 7. Return list.
  return list;
}

/** https://tc39.es/ecma262/#sec-invoke */
export function* Invoke(V: Value, P: PropertyKeyValue | string, argumentsList: Arguments = []): ValueEvaluator {
  if (P instanceof JSStringValue) P = P.stringValue();
  const func = Q(yield* GetV(V, P));
  return Q(yield* Call(func, V, argumentsList));
}

/** https://tc39.es/ecma262/#sec-ordinaryhasinstance */
export function* OrdinaryHasInstance(constructor: Value, O: Value): PlainEvaluator<boolean> {
  if (!IsCallable(constructor)) {
    return false;
  }
  if (isBoundFunctionObject(constructor)) {
    const BC = constructor.BoundTargetFunction;
    return Q(yield* InstanceofOperator(O, BC));
  }
  if (!(O instanceof ObjectValue)) {
    return false;
  }
  const P = Q(yield* Get(constructor, 'prototype'));
  if (!(P instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', P);
  }
  while (true) {
    O = Q(yield* O.GetPrototypeOf());
    if (O instanceof NullValue) {
      return false;
    }
    if (SameValue(P, O)) {
      return true;
    }
  }
}

/** https://tc39.es/ecma262/#sec-speciesconstructor */
export function* SpeciesConstructor(O: ObjectValue, defaultConstructor: FunctionObject): ValueEvaluator<FunctionObject> {
  Assert(O instanceof ObjectValue);
  const constructor = Q(yield* Get(O, 'constructor'));
  if (constructor === Value.undefined) {
    return defaultConstructor;
  }
  if (!(constructor instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', constructor);
  }
  const S = Q(yield* Get(constructor, wellKnownSymbols.species));
  if (S === Value.undefined || S === Value.null) {
    return defaultConstructor;
  }
  if (IsConstructor(S)) {
    return S;
  }
  return Throw.TypeError('object.constructor[Symbol.species] is not a constructor');
}

/** https://tc39.es/ecma262/#sec-enumerableownpropertynames */
export function EnumerableOwnProperties(O: ObjectValue, kind: 'key'): PlainEvaluator<JSStringValue[]>
export function EnumerableOwnProperties(O: ObjectValue, kind: 'value'): PlainEvaluator<Value[]>
export function EnumerableOwnProperties(O: ObjectValue, kind: 'key' | 'value' | 'key+value'): PlainEvaluator<ObjectValue[]>
export function* EnumerableOwnProperties(O: ObjectValue, kind: 'key' | 'value' | 'key+value'): PlainEvaluator<Value[]> {
  const ownKeys = Q(yield* O.OwnPropertyKeys());
  const results = [];
  for (const key of ownKeys) {
    if (key instanceof JSStringValue) {
      const desc = Q(yield* O.GetOwnProperty(key));
      if (desc && desc.Enumerable) {
        if (kind === 'key') {
          results.push(key);
        } else {
          const value = Q(yield* Get(O, key));
          if (kind === 'value') {
            results.push(value);
          } else {
            Assert(kind === 'key+value');
            const entry = X(CreateArrayFromList([key, value]));
            results.push(entry);
          }
        }
      }
    }
  }
  return results;
}

/** https://tc39.es/ecma262/#sec-getfunctionrealm */
export function GetFunctionRealm(obj: FunctionObject): PlainCompletion<Realm> {
  Assert(IsCallable(obj));
  if ('Realm' in (obj as object)) {
    return obj.Realm;
  }

  if (isBoundFunctionObject(obj)) {
    const target = obj.BoundTargetFunction;
    return Q(GetFunctionRealm(target));
  }

  if (isProxyExoticObject(obj)) {
    if (obj.ProxyHandler instanceof NullValue) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'GetFunctionRealm');
    }
    const proxyTarget = obj.ProxyTarget as FunctionObject;
    return Q(GetFunctionRealm(proxyTarget));
  }

  return surroundingAgent.currentRealmRecord;
}

/** https://tc39.es/ecma262/#sec-copydataproperties */
export function* CopyDataProperties(target: ObjectValue, source: Value, excludedItems: readonly PropertyKeyValue[]): ValueEvaluator<ObjectValue> {
  Assert(target instanceof ObjectValue);
  Assert(excludedItems.every((i) => IsPropertyKey(i)));
  if (source === Value.undefined || source === Value.null) {
    return target;
  }
  const from = X(ToObject(source));
  const keys = Q(yield* from.OwnPropertyKeys());
  for (const nextKey of keys) {
    let excluded = false;
    for (const e of excludedItems) {
      if (SameValue(e, nextKey)) {
        excluded = true;
      }
    }
    if (excluded === false) {
      const desc = Q(yield* from.GetOwnProperty(nextKey));
      if (desc && desc.Enumerable) {
        const propValue = Q(yield* Get(from, nextKey));
        X(CreateDataProperty(target, nextKey, propValue));
      }
    }
  }
  return target;
}

export { PrivateElementFind } from './private-names.mts';
export { PrivateFieldAdd } from './private-names.mts';
export { PrivateMethodOrAccessorAdd } from './private-names.mts';
// HostEnsureCanAddPrivateElement only for browsers
export { PrivateGet } from './private-names.mts';
export { PrivateSet } from './private-names.mts';
export { DefineField } from './function-operations.mts';
export { InitializeInstanceElements } from './function-operations.mts';

export type KeyedGroupRecord = {
  Key: PropertyKeyValue,
  Elements: Value[]
};

/** https://tc39.es/ecma262/#sec-add-value-to-keyed-group */
export function AddValueToKeyedGroup(groups: KeyedGroupRecord[], key: PropertyKeyValue, value: Value): void {
  /*
    1. For each Record { [[Key]], [[Elements]] } g of groups, do
      a. If SameValue(g.[[Key]], key) is true, then
        i. Assert: Exactly one element of groups meets this criterion.
        ii. Append value to g.[[Elements]].
        iii. Return unused.
    2. Let group be the Record { [[Key]]: key, [[Elements]]: « value » }.
    3. Append group to groups.
    4. Return unused.
  */
  for (const g of groups) {
    if (SameValue(g.Key, key)) {
      let count = 0;
      for (const otherG of groups) {
        if (SameValue(otherG.Key, key)) {
          count += 1;
        }
      }
      Assert(count === 1);
      g.Elements.push(value);
      return;
    }
  }

  const group: KeyedGroupRecord = { Key: key, Elements: [value] };
  groups.push(group);
}

/** https://tc39.es/ecma262/#sec-groupby */
export function* GroupBy(items: Value, callback: Value, keyCoercion: 'property' | 'collection'): PlainEvaluator<KeyedGroupRecord[]> {
  /*
  1. Perform ? RequireObjectCoercible(items).
  2. If IsCallable(callback) is false, throw a TypeError exception.
  3. Let groups be a new empty List.
  4. Let iteratorRecord be ? GetIterator(items, sync).
  5. Let k be 0.
  */
  Q(RequireObjectCoercible(items));
  if (!IsCallable(callback)) {
    return Throw.TypeError('$1 is not a function', callback);
  }
  const groups: KeyedGroupRecord[] = [];
  const iteratorRecord = Q(yield* GetIterator(items, 'sync'));
  let k = 0;
  const MAX_SAFE_INTEGER = (2 ** 53) - 1;

  while (true) {
    /*
    6. Repeat,
      a. If k ≥ 2**53 - 1, then
        i. Let error be ThrowCompletion(a newly created TypeError object).
        ii. Return ? IteratorClose(iteratorRecord, error).
      b. Let next be ? IteratorStepValue(iteratorRecord).
      c. If next is done, then
        i. Return groups.
      d. Let value be next.
      e. Let key be Completion(Call(callback, undefined, « value, 𝔽(k) »)).
      f. IfAbruptCloseIterator(key, iteratorRecord).
      g. If keyCoercion is property, then
        i. Set key to Completion(ToPropertyKey(key)).
        ii. IfAbruptCloseIterator(key, iteratorRecord).
      h. Else,
        i. Assert: keyCoercion is collection.
        ii. Set key to CanonicalizeKeyedCollectionKey(key).
      i. Perform AddValueToKeyedGroup(groups, key, value).
      j. Set k to k + 1.
    */
    if (k >= MAX_SAFE_INTEGER) {
      const error = Throw.TypeError('$1 is out of range', k);
      return Q(yield* IteratorClose(iteratorRecord, error));
    }
    const next: Value | 'done' = Q(yield* IteratorStepValue(iteratorRecord));
    if (next === 'done') {
      return groups;
    }
    const value: Value = next;
    let key: ValueCompletion = yield* Call(callback, Value.undefined, [value, F(k)]);
    IfAbruptCloseIterator(key, iteratorRecord);
    __ts_cast__<Value>(key);

    if (keyCoercion === 'property') {
      key = yield* ToPropertyKey(key);
      IfAbruptCloseIterator(key, iteratorRecord);
    } else {
      Assert(keyCoercion === 'collection');
      key = CanonicalizeKeyedCollectionKey(key);
    }
    __ts_cast__<PropertyKeyValue>(key);

    AddValueToKeyedGroup(groups, key, value);
    k += 1;
  }
}

/** https://tc39.es/proposal-temporal/#sec-getoptionsobject */
export function GetOptionsObject(options: Value) {
  if (options instanceof UndefinedValue) {
    return OrdinaryObjectCreate(Value.null);
  }
  if (options instanceof ObjectValue) {
    return options;
  }
  return Throw.TypeError('$1 is not an object', options);
}

/** https://tc39.es/ecma262/#sec-SetterThatIgnoresPrototypeProperties */
export function* SetterThatIgnoresPrototypeProperties(thisValue: Value, home: ObjectValue, propertyKey: PropertyKeyValue, value: Value): PlainEvaluator {
  // 1. If thisValue is not an Object, then
  if (!(thisValue instanceof ObjectValue)) {
    // a. Throw a TypeError exception.
    return Throw.TypeError('$1 is not an object', thisValue);
  }
  // 2. If SameValue(thisValue, home) is true, then
  if (SameValue(thisValue, home)) {
    // a. NOTE: Throwing here emulates assignment to a non-writable data property on the home object in strict mode code.
    // b. Throw a TypeError exception.
    return Throw.TypeError('Cannot set property $1 on $2', propertyKey, thisValue);
  }
  // 3. Let desc be ? thisValue.[[GetOwnProperty]](p).
  const desc = Q(yield* thisValue.GetOwnProperty(propertyKey));
  // 4. If desc is undefined, then
  if (!desc) {
    Q(yield* CreateDataPropertyOrThrow(thisValue, propertyKey, value));
  } else {
    Q(yield* Set(thisValue, propertyKey, value, true));
  }
  return undefined;
}
