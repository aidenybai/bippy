import {
  Descriptor,
  ObjectValue,
  SymbolValue, JSStringValue, UndefinedValue, NullValue,
  Value,
  type PropertyKeyValue,
  type CanBeNativeSteps,
} from '../value.mts';
import {
  Q, X,
} from '../completion.mts';
import type { Mutable } from '../utils/language.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  Assert,
  Call,
  CreateDataProperty,
  Get,
  GetFunctionRealm,
  IsAccessorDescriptor,
  IsCallable,
  IsDataDescriptor,
  IsExtensible,
  IsGenericDescriptor,
  IsPropertyKey,
  SameValue,
  MakeBasicObject,
  isArrayIndex,
  type FunctionObject,
  type Intrinsics,
} from './all.mts';
import { CreateBuiltinFunction, surroundingAgent, type PlainEvaluator, type FullyPopulatedDescriptor, type DataDescriptorInit, type AccessorDescriptorInit } from '#self';

export interface OrdinaryObject extends ObjectValue {
  Prototype: ObjectValue | NullValue;
  Extensible: boolean;
}

export function isOrdinaryObject(value: Value): value is OrdinaryObject {
  return value instanceof ObjectValue
    && value.GetPrototypeOf === ObjectValue.prototype.GetPrototypeOf
    && value.SetPrototypeOf === ObjectValue.prototype.SetPrototypeOf
    && value.IsExtensible === ObjectValue.prototype.IsExtensible
    && value.PreventExtensions === ObjectValue.prototype.PreventExtensions
    && value.GetOwnProperty === ObjectValue.prototype.GetOwnProperty
    && value.DefineOwnProperty === ObjectValue.prototype.DefineOwnProperty
    && value.HasProperty === ObjectValue.prototype.HasProperty
    && value.Get === ObjectValue.prototype.Get
    && value.Set === ObjectValue.prototype.Set
    && value.Delete === ObjectValue.prototype.Delete
    && value.OwnPropertyKeys === ObjectValue.prototype.OwnPropertyKeys
    && 'Prototype' in value
    && 'Extensible' in value;
}

// TODO: ban other direct extension from ObjectValue in the linter
export type ExoticObject = ObjectValue;

/** https://tc39.es/ecma262/#sec-ordinarygetprototypeof */
export function OrdinaryGetPrototypeOf(obj: OrdinaryObject) {
  return obj.Prototype;
}

/** https://tc39.es/ecma262/#sec-ordinarysetprototypeof */
export function OrdinarySetPrototypeOf(obj: OrdinaryObject, proto: ObjectValue | NullValue): boolean {
  Assert(proto instanceof ObjectValue || proto instanceof NullValue);

  const current = obj.Prototype;
  if (SameValue(proto, current)) return true;
  const extensible = obj.Extensible;
  if (!extensible) return false;
  let cursor = proto;
  let done = false;
  while (!done) {
    if (cursor instanceof NullValue) {
      done = true;
    } else if (SameValue(cursor, obj)) {
      return false;
    } else {
      if (cursor.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf) {
        done = true;
      } else {
        cursor = (cursor as OrdinaryObject).Prototype;
      }
    }
  }
  obj.Prototype = proto;
  return true;
}

/** https://tc39.es/ecma262/#sec-ordinaryisextensible */
export function OrdinaryIsExtensible(obj: OrdinaryObject) {
  return obj.Extensible;
}

/** https://tc39.es/ecma262/#sec-ordinarypreventextensions */
export function OrdinaryPreventExtensions(obj: OrdinaryObject): boolean {
  obj.Extensible = false;
  return true;
}

/** https://tc39.es/ecma262/#sec-ordinarygetownproperty */
export function OrdinaryGetOwnProperty(obj: ObjectValue, propertyKey: PropertyKeyValue | string): FullyPopulatedDescriptor | undefined {
  if (!obj.properties.has(propertyKey)) {
    return undefined;
  }

  const propertyDesc = {} as Mutable<AccessorDescriptorInit & DataDescriptorInit>;
  const ownProperty = obj.properties.get(propertyKey)!;

  if (IsDataDescriptor(ownProperty)) {
    propertyDesc.Value = ownProperty.Value;
    propertyDesc.Writable = ownProperty.Writable;
  } else if (IsAccessorDescriptor(ownProperty)) {
    propertyDesc.Get = ownProperty.Get;
    propertyDesc.Set = ownProperty.Set;
  } else {
    throw new TypeError('Invalid property descriptor stored on an object.');
  }
  propertyDesc.Enumerable = ownProperty.Enumerable;
  propertyDesc.Configurable = ownProperty.Configurable;

  return Descriptor(propertyDesc) as FullyPopulatedDescriptor;
}

/** https://tc39.es/ecma262/#sec-ordinarydefineownproperty */
export function* OrdinaryDefineOwnProperty(obj: ObjectValue, propertyKey: PropertyKeyValue | string, propertyDesc: Descriptor): PlainEvaluator<boolean> {
  Assert(typeof propertyKey === 'string' || IsPropertyKey(propertyKey));
  const current = Q(yield* obj.GetOwnProperty(propertyKey));
  const extensible = Q(yield* IsExtensible(obj));
  return ValidateAndApplyPropertyDescriptor(obj, propertyKey, extensible, propertyDesc, current);
}

/** https://tc39.es/ecma262/#sec-iscompatiblepropertydescriptor */
export function IsCompatiblePropertyDescriptor(extensible: boolean, propertyDesc: Descriptor, current: undefined | FullyPopulatedDescriptor) {
  return ValidateAndApplyPropertyDescriptor(undefined, "", extensible, propertyDesc, current);
}

/** https://tc39.es/ecma262/#sec-validateandapplypropertydescriptor */
export function ValidateAndApplyPropertyDescriptor(obj: ObjectValue | undefined, propertyKey: PropertyKeyValue | string, extensible: boolean, propertyDesc: Descriptor, current: undefined | FullyPopulatedDescriptor): boolean {
  if (!current) {
    if (!extensible) return false;
    if (!obj) return true;

    if (IsAccessorDescriptor(propertyDesc)) {
      obj.properties.set(propertyKey, Descriptor({
        Get: propertyDesc.Get ?? Value.undefined,
        Set: propertyDesc.Set ?? Value.undefined,
        Enumerable: propertyDesc.Enumerable ?? false,
        Configurable: propertyDesc.Configurable ?? false,
      }));
    } else {
      obj.properties.set(propertyKey, Descriptor({
        Value: propertyDesc.Value ?? Value.undefined,
        Writable: propertyDesc.Writable ?? false,
        Enumerable: propertyDesc.Enumerable ?? false,
        Configurable: propertyDesc.Configurable ?? false,
      }));
    }
    return true;
  }

  if (Descriptor.everyFieldIsAbsent(propertyDesc)) return true;
  if (!current.Configurable) {
    if (propertyDesc.Configurable !== undefined && propertyDesc.Configurable === true) return false;
    if (propertyDesc.Enumerable !== undefined && propertyDesc.Enumerable !== current.Enumerable) return false;
    if (!IsGenericDescriptor(propertyDesc) && IsAccessorDescriptor(propertyDesc) !== IsAccessorDescriptor(current)) return false;
    if (IsAccessorDescriptor(current)) {
      if (propertyDesc.Get && SameValue(propertyDesc.Get, current.Get) === false) return false;
      if (propertyDesc.Set && SameValue(propertyDesc.Set, current.Set) === false) return false;
    } else if (!current.Writable) {
      if (propertyDesc.Writable !== undefined && propertyDesc.Writable) return false;
      // ii. NOTE: SameValue returns true for NaN values which may be distinguishable by other means. Returning here ensures that any existing property of obj remains unmodified.
      if (propertyDesc.Value !== undefined) return SameValue(propertyDesc.Value, current.Value);
    }
  }

  if (obj) {
    if (IsDataDescriptor(current) && IsAccessorDescriptor(propertyDesc)) {
      const configurable = propertyDesc.Configurable !== undefined ? propertyDesc.Configurable : current.Configurable;
      const enumerable = propertyDesc.Enumerable !== undefined ? propertyDesc.Enumerable : current.Enumerable;
      obj.properties.set(propertyKey, Descriptor({
        // note: type definition of Get and Set is not precise, one of Get/Set may be undefined (instead of Value.undefined)
        Get: propertyDesc.Get ?? Value.undefined,
        Set: propertyDesc.Set ?? Value.undefined,
        Enumerable: enumerable,
        Configurable: configurable,
      }));
    } else if (IsAccessorDescriptor(current) && IsDataDescriptor(propertyDesc)) {
      const configurable = propertyDesc.Configurable !== undefined ? propertyDesc.Configurable : current.Configurable;
      const enumerable = propertyDesc.Enumerable !== undefined ? propertyDesc.Enumerable : current.Enumerable;
      obj.properties.set(propertyKey, Descriptor({
        Value: propertyDesc.Value ?? Value.undefined,
        Writable: propertyDesc.Writable ?? false,
        Enumerable: enumerable,
        Configurable: configurable,
      }));
    } else {
      const existing = obj.properties.get(propertyKey)!;
      if (IsAccessorDescriptor(existing)) {
        obj.properties.set(propertyKey, Descriptor({
          Get: propertyDesc.Get ?? existing.Get,
          Set: propertyDesc.Set ?? existing.Set,
          Enumerable: propertyDesc.Enumerable ?? existing.Enumerable,
          Configurable: propertyDesc.Configurable ?? existing.Configurable,
        } as Required<AccessorDescriptorInit>));
      } else {
        obj.properties.set(propertyKey, Descriptor({
          Value: propertyDesc.Value ?? existing.Value,
          Writable: propertyDesc.Writable ?? existing.Writable,
          Enumerable: propertyDesc.Enumerable ?? existing.Enumerable,
          Configurable: propertyDesc.Configurable ?? existing.Configurable,
        } as Required<DataDescriptorInit>));
      }
    }
  }
  return true;
}

// 9.1.7.1 OrdinaryHasProperty
export function* OrdinaryHasProperty(O: ObjectValue, P: PropertyKeyValue | string): PlainEvaluator<boolean> {
  Assert(typeof P === 'string' || IsPropertyKey(P));

  const hasOwn = Q(yield* O.GetOwnProperty(P));
  if (hasOwn) {
    return true;
  }
  const parent = Q(yield* O.GetPrototypeOf());
  if (!(parent instanceof NullValue)) {
    return Q(yield* parent.HasProperty(P));
  }
  return false;
}

// 9.1.8.1
export function* OrdinaryGet(O: ObjectValue, P: PropertyKeyValue | string, Receiver: Value): ValueEvaluator {
  Assert(typeof P === 'string' || IsPropertyKey(P));

  const desc = Q(yield* O.GetOwnProperty(P));
  if (!desc) {
    const parent = Q(yield* O.GetPrototypeOf());
    if (parent instanceof NullValue) {
      return Value.undefined;
    }
    return Q(yield* parent.Get(P, Receiver));
  }
  if (IsDataDescriptor(desc)) {
    return desc.Value;
  }
  Assert(IsAccessorDescriptor(desc));
  const getter = desc.Get;
  if (getter instanceof UndefinedValue) {
    return Value.undefined;
  }
  return Q(yield* Call(getter, Receiver));
}

// 9.1.9.1 OrdinarySet
export function* OrdinarySet(O: ObjectValue, P: PropertyKeyValue | string, V: Value, Receiver: Value) {
  Assert(typeof P === 'string' || IsPropertyKey(P));
  const ownDesc = Q(yield* O.GetOwnProperty(P));
  return yield* OrdinarySetWithOwnDescriptor(O, P, V, Receiver, ownDesc);
}

// 9.1.9.2 OrdinarySetWithOwnDescriptor
export function* OrdinarySetWithOwnDescriptor(O: ObjectValue, P: PropertyKeyValue | string, V: Value, Receiver: Value, ownDesc: Descriptor | undefined): PlainEvaluator<boolean> {
  Assert(typeof P === 'string' || IsPropertyKey(P));

  if (!ownDesc) {
    const parent = Q(yield* O.GetPrototypeOf());
    if (!(parent instanceof NullValue)) {
      return Q(yield* parent.Set(P, V, Receiver));
    }
    ownDesc = Descriptor({
      Value: Value.undefined,
      Writable: true,
      Enumerable: true,
      Configurable: true,
    });
  }

  if (IsDataDescriptor(ownDesc)) {
    if (ownDesc.Writable !== undefined && !ownDesc.Writable) {
      return false;
    }
    if (!(Receiver instanceof ObjectValue)) {
      return false;
    }

    const existingDescriptor = Q(yield* Receiver.GetOwnProperty(P));
    if (existingDescriptor) {
      if (IsAccessorDescriptor(existingDescriptor)) {
        return false;
      }
      if (!existingDescriptor.Writable) {
        return false;
      }
      const valueDesc = Descriptor({ Value: V });
      return Q(yield* Receiver.DefineOwnProperty(P, valueDesc));
    }
    return yield* CreateDataProperty(Receiver, P, V);
  }

  Assert(IsAccessorDescriptor(ownDesc));
  const setter = ownDesc.Set;
  if (setter === undefined || setter instanceof UndefinedValue) {
    return false;
  }
  Q(yield* Call(setter, Receiver, [V]));
  return true;
}

// 9.1.10.1 OrdinaryDelete
export function* OrdinaryDelete(O: ObjectValue, P: PropertyKeyValue | string): PlainEvaluator<boolean> {
  Assert(typeof P === 'string' || IsPropertyKey(P));
  const desc = Q(yield* O.GetOwnProperty(P));
  if (!desc) {
    return true;
  }
  if (desc.Configurable) {
    O.properties.delete(P);
    return true;
  }
  return false;
}

// 9.1.11.1
export function OrdinaryOwnPropertyKeys(O: ObjectValue) {
  const keys: PropertyKeyValue[] = [];

  // For each own property key P of O that is an array index, in ascending numeric index order, do
  //   Add P as the last element of keys.
  for (const P of O.properties.keys()) {
    if (isArrayIndex(P)) {
      keys.push(P);
    }
  }
  keys.sort((a, b) => Number.parseInt((a as JSStringValue).stringValue(), 10) - Number.parseInt((b as JSStringValue).stringValue(), 10));

  // For each own property key P of O such that Type(P) is String and
  // P is not an array index, in ascending chronological order of property creation, do
  //   Add P as the last element of keys.
  for (const P of O.properties.keys()) {
    if (P instanceof JSStringValue && isArrayIndex(P) === false) {
      keys.push(P);
    }
  }

  // For each own property key P of O such that Type(P) is Symbol,
  // in ascending chronological order of property creation, do
  //   Add P as the last element of keys.
  for (const P of O.properties.keys()) {
    if (P instanceof SymbolValue) {
      keys.push(P);
    }
  }

  return keys;
}

/** https://tc39.es/ecma262/#sec-ordinaryobjectcreate */
export function OrdinaryObjectCreate<const T extends string>(proto: ObjectValue | NullValue, additionalInternalSlotsList?: readonly T[]) {
  Assert(!!proto);
  // 1. Let internalSlotsList be « [[Prototype]], [[Extensible]] ».
  const internalSlotsList: ['Prototype', 'Extensible', ...T[]] = ['Prototype', 'Extensible'];
  // 2. If additionalInternalSlotsList is present, append each of its elements to internalSlotsList.
  if (additionalInternalSlotsList !== undefined) {
    internalSlotsList.push(...additionalInternalSlotsList);
  }
  // 3. Let O be ! MakeBasicObject(internalSlotsList).
  const O = X(MakeBasicObject(internalSlotsList)) as OrdinaryObject;
  // 4. Set O.[[Prototype]] to proto.
  O.Prototype = proto;
  // 5. Return O.
  return O;
}

/** This is a helper function to define non-spec host objects. */
OrdinaryObjectCreate.from = (object: Record<string, Value | CanBeNativeSteps>, proto?: ObjectValue | NullValue) => {
  const O = OrdinaryObjectCreate(proto || surroundingAgent.intrinsic('%Object.prototype%'));
  for (const key in object) {
    if (Object.hasOwn(object, key)) {
      const value = object[key];
      X(CreateDataProperty(O, Value(key), value instanceof Value ? value : CreateBuiltinFunction.from(value, key)));
    }
  }
  return O;
};

// 9.1.13 OrdinaryCreateFromConstructor
export function* OrdinaryCreateFromConstructor<const T extends string>(constructor: FunctionObject, intrinsicDefaultProto: keyof Intrinsics, internalSlotsList?: readonly T[]): ValueEvaluator<ObjectValue> {
  // Assert: intrinsicDefaultProto is a String value that is this specification's name of an intrinsic object.
  const proto = Q(yield* GetPrototypeFromConstructor(constructor, intrinsicDefaultProto));
  return OrdinaryObjectCreate(proto, internalSlotsList);
}

// 9.1.14 GetPrototypeFromConstructor
export function* GetPrototypeFromConstructor(constructor: FunctionObject, intrinsicDefaultProto: keyof Intrinsics): ValueEvaluator<ObjectValue> {
  // Assert: intrinsicDefaultProto is a String value that
  // is this specification's name of an intrinsic object.
  Assert(IsCallable(constructor));
  let proto = Q(yield* Get(constructor, 'prototype'));
  if (!(proto instanceof ObjectValue)) {
    const realm = Q(GetFunctionRealm(constructor));
    proto = realm.Intrinsics[intrinsicDefaultProto];
  }
  return proto;
}
