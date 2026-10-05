import {
  ObjectValue, Value, NumberValue,
  JSStringValue,
  UndefinedValue,
  type ObjectInternalMethods,
  SymbolValue,
  Descriptor,
} from '../value.mts';
import {
  Q, X,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import {
  type TypedArrayObject, TypedArrayElementSize, TypedArrayElementType,
} from '../intrinsics/TypedArray.mts';
import { isDataViewObject, type DataViewObject } from '../intrinsics/DataView.mts';
import {
  Assert,
  IsDetachedBuffer,
  R,
  ArrayBufferByteLength,
  IsFixedLengthArrayBuffer,
  type ArrayBufferObject,
  MakeBasicObject,
  isIntegerIndex,
  ToString,
  OrdinaryDelete,
  CanonicalNumericIndexString,
  F,
  IsAccessorDescriptor,
  OrdinaryDefineOwnProperty,
  OrdinaryGet,
  OrdinaryGetOwnProperty,
  OrdinaryHasProperty,
  OrdinarySet,
  GetValueFromBuffer,
  SetValueInBuffer,
  ToBigInt,
  ToNumber,
  IsSharedArrayBuffer,
  OrdinaryPreventExtensions,
  SameValue,
  IsIntegralNumber,
  IsViewOutOfBounds,
  MakeDataViewWithBufferWitnessRecord,
} from './all.mts';
import type { BigIntValue, FullyPopulatedDescriptor, PlainEvaluator, PropertyKeyValue } from '#self';

const InternalMethods = {
  /** https://tc39.es/ecma262/#sec-typedarray-preventextensions */
  * PreventExtensions(): PlainEvaluator<boolean> {
    const O = this;
    if (!IsTypedArrayFixedLength(O)) {
      return false;
    }
    return OrdinaryPreventExtensions(O);
  },
  /** https://tc39.es/ecma262/#sec-typedarray-getownproperty */
  * GetOwnProperty(P): PlainEvaluator<FullyPopulatedDescriptor | undefined> {
    const O = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    if (typeof P === 'string') {
      // a. Let numericIndex be CanonicalNumericIndexString(P).
      const numericIndex = CanonicalNumericIndexString(P);
      // b. If numericIndex is not undefined, then
      if (numericIndex !== undefined) {
        // i. Let value be TypedArrayGetElement(O, numericIndex).
        const value = TypedArrayGetElement(O, numericIndex);
        // ii. If value is undefined, return undefined.
        if (value instanceof UndefinedValue) {
          return undefined;
        }
        // iii. Return the PropertyDescriptor { [[Value]]: value, [[Writable]]: true, [[Enumerable]]: true, [[Configurable]]: true }.
        return Descriptor({
          Value: value,
          Writable: true,
          Enumerable: true,
          Configurable: true,
        });
      }
    }
    // 4. Return OrdinaryGetOwnProperty(O, P).
    return OrdinaryGetOwnProperty(O, P);
  },
  /** https://tc39.es/ecma262/#sec-typedarray-hasproperty */
  * HasProperty(P): PlainEvaluator<boolean> {
    const O = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    if (typeof P === 'string') {
      // a. Let numericIndex be CanonicalNumericIndexString(P).
      const numericIndex = CanonicalNumericIndexString(P);
      // b. If numericIndex is not undefined, then
      if (numericIndex !== undefined) {
        return IsValidIntegerIndex(O, numericIndex);
      }
    }
    // 4. Return ? OrdinaryHasProperty(O, P)
    return Q(yield* OrdinaryHasProperty(O, P));
  },
  /** https://tc39.es/ecma262/#sec-typedarray-defineownproperty */
  * DefineOwnProperty(P, Desc): PlainEvaluator<boolean> {
    const O = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    if (typeof P === 'string') {
      // a. Let numericIndex be CanonicalNumericIndexString(P).
      const numericIndex = CanonicalNumericIndexString(P);
      // b. If numericIndex is not undefined, then
      if (numericIndex !== undefined) {
        // i. If ! IsValidIntegerIndex(O, numericIndex) is false, return false.
        if (!IsValidIntegerIndex(O, numericIndex)) {
          return false;
        }
        // iii. If Desc has a [[Configurable]] field and if Desc.[[Configurable]] is true, return false.
        if (Desc.Configurable === false) {
          return false;
        }
        // iv. If Desc has an [[Enumerable]] field and if Desc.[[Enumerable]] is false, return false.
        if (Desc.Enumerable === false) {
          return false;
        }
        // ii. If IsAccessorDescriptor(Desc) is true, return false.
        if (IsAccessorDescriptor(Desc)) {
          return false;
        }
        // v. If Desc has a [[Writable]] field and if Desc.[[Writable]] is false, return false.
        if (Desc.Writable === false) {
          return false;
        }
        // vi. If Desc has a [[Value]] field, then
        if (Desc.Value !== undefined) {
          return Q(yield* TypedArraySetElement(O, numericIndex, Desc.Value));
        }
        // vii. Return true.
        return true;
      }
    }
    // 4. Return ! OrdinaryDefineOwnProperty(O, P, Desc).
    return Q(yield* OrdinaryDefineOwnProperty(O, P, Desc));
  },
  /** https://tc39.es/ecma262/#sec-typedarray-get */
  * Get(P, Receiver) {
    const O = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    if (typeof P === 'string') {
      // a. Let numericIndex be CanonicalNumericIndexString(P).
      const numericIndex = CanonicalNumericIndexString(P);
      // b. If numericIndex is not undefined, then
      if (numericIndex !== undefined) {
        // i. Return ! IntegerIndexedElementGet(O, numericIndex).
        return X(TypedArrayGetElement(O, numericIndex));
      }
    }
    // 3. Return ? OrdinaryGet(O, P, Receiver).
    return Q(yield* OrdinaryGet(O, P, Receiver));
  },
  /** https://tc39.es/ecma262/#sec-typedarray-set */
  * Set(P, V, Receiver): PlainEvaluator<boolean> {
    const O = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    if (typeof P === 'string') {
      // a. Let numericIndex be CanonicalNumericIndexString(P).
      const numericIndex = CanonicalNumericIndexString(P);
      // b. If numericIndex is not undefined, then
      if (numericIndex !== undefined) {
        if (SameValue(O, Receiver)) {
          // i. Perform ? IntegerIndexedElementSet(O, numericIndex, V).
          Q(yield* TypedArraySetElement(O, numericIndex, V));
          // ii. Return true.
          return true;
        }
        if (!IsValidIntegerIndex(O, numericIndex)) {
          return true;
        }
      }
    }
    // 3. Return ? OrdinarySet(O, P, V, Receiver).
    return Q(yield* OrdinarySet(O, P, V, Receiver));
  },
  /** https://tc39.es/ecma262/#sec-typedarray-delete */
  * Delete(P): PlainEvaluator<boolean> {
    const O = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    if (typeof P === 'string') {
      // a. Let numericIndex be ! CanonicalNumericIndexString(P).
      const numericIndex = CanonicalNumericIndexString(P);
      // b. If numericIndex is not undefined, then
      if (numericIndex !== undefined) {
        // ii. If IsValidIntegerIndex(O, numericIndex) is false, return true.
        if (!IsValidIntegerIndex(O, numericIndex)) {
          return true;
        } else {
          // iii. Return false.
          return false;
        }
      }
    }
    // 4. Return ? OrdinaryDelete(O, P).
    return Q(yield* OrdinaryDelete(O, P));
  },
  /** https://tc39.es/ecma262/#sec-typedarray-ownpropertykeys */
  * OwnPropertyKeys() {
    const O = this;
    const taRecord = MakeTypedArrayWithBufferWitnessRecord(O, 'seq-cst');
    // 1. Let keys be a new empty List.
    const keys: PropertyKeyValue[] = [];
    if (!IsTypedArrayOutOfBounds(taRecord)) {
      const length = TypedArrayLength(taRecord);
      // 4. For each integer i starting with 0 such that i < len, in ascending order, do
      for (let i = 0; i < length; i += 1) {
        // a. Add ! ToString(𝔽(i)) as the last element of keys.
        keys.push(Value(X(ToString(F(i)))));
      }
    }
    // 5. For each own property key P of O such that Type(P) is String and P is not an integer index, in ascending chronological order of property creation, do
    for (const P of O.properties.keys()) {
      if (P instanceof JSStringValue) {
        if (!isIntegerIndex(P)) {
          // a. Add P as the last element of keys.
          keys.push(P);
        }
      }
    }
    // 6. For each own property key P of O such that Type(P) is Symbol, in ascending chronological order of property creation, do
    for (const P of O.properties.keys()) {
      if (P instanceof SymbolValue) {
        // a. Add P as the last element of keys.
        keys.push(P);
      }
    }
    // 7. Return keys.
    return keys;
  },
} satisfies Partial<ObjectInternalMethods<TypedArrayObject>>;

/** https://tc39.es/ecma262/#sec-typedarray-with-buffer-witness-records */
export interface TypedArrayWithBufferWitnessRecord {
  readonly Object: TypedArrayObject;
  readonly CachedBufferByteLength: 'detached' | number;
}

/** https://tc39.es/ecma262/#sec-maketypedarraywithbufferwitnessrecord */
export function MakeTypedArrayWithBufferWitnessRecord(obj: TypedArrayObject, order: 'seq-cst' | 'unordered') {
  const buffer = obj.ViewedArrayBuffer;
  let byteLength: TypedArrayWithBufferWitnessRecord['CachedBufferByteLength'];
  if (IsDetachedBuffer(buffer as ArrayBufferObject)) {
    byteLength = 'detached';
  } else {
    byteLength = ArrayBufferByteLength(buffer as ArrayBufferObject, order);
  }
  return { Object: obj, CachedBufferByteLength: byteLength };
}

/** https://tc39.es/ecma262/#sec-typedarraycreate */
export function TypedArrayCreate(prototype: ObjectValue) {
  const internalSlotsList = ['Prototype', 'Extensible', 'ViewedArrayBuffer', 'TypedArrayName', 'ContentType', 'ByteLength', 'ByteOffset', 'ArrayLength'] as const;
  const array = MakeBasicObject(internalSlotsList);
  array.PreventExtensions = InternalMethods.PreventExtensions;
  array.GetOwnProperty = InternalMethods.GetOwnProperty;
  array.HasProperty = InternalMethods.HasProperty;
  array.DefineOwnProperty = InternalMethods.DefineOwnProperty;
  array.Get = InternalMethods.Get;
  array.Set = InternalMethods.Set;
  array.Delete = InternalMethods.Delete;
  array.OwnPropertyKeys = InternalMethods.OwnPropertyKeys;
  array.Prototype = prototype;
  return array;
}

/** https://tc39.es/ecma262/#sec-typedarraybytelength */
export function TypedArrayByteLength(taRecord: TypedArrayWithBufferWitnessRecord): number {
  Assert(!IsTypedArrayOutOfBounds(taRecord));
  const O = taRecord.Object;
  if (O.ByteLength !== 'auto') {
    return O.ByteLength;
  }
  const length = TypedArrayLength(taRecord);
  const elementSize = TypedArrayElementSize(O);
  return length * elementSize;
}

/** https://tc39.es/ecma262/#sec-typedarraylength */
export function TypedArrayLength(taRecord: TypedArrayWithBufferWitnessRecord): number {
  Assert(IsTypedArrayOutOfBounds(taRecord) === false);
  const O = taRecord.Object;
  if (O.ArrayLength !== 'auto') {
    return O.ArrayLength;
  }
  Assert(!IsFixedLengthArrayBuffer(O.ViewedArrayBuffer as ArrayBufferObject));
  const byteOffset = O.ByteOffset;
  const elementSize = TypedArrayElementSize(O);
  const bufferLength = taRecord.CachedBufferByteLength;
  Assert(bufferLength !== 'detached');
  return Math.floor((bufferLength - byteOffset) / elementSize);
}

/** https://tc39.es/ecma262/#sec-istypedarrayoutofbounds */
export function IsTypedArrayOutOfBounds(taRecord: TypedArrayWithBufferWitnessRecord) {
  const O = taRecord.Object;
  const bufferByteLength = taRecord.CachedBufferByteLength;
  if (IsDetachedBuffer(O.ViewedArrayBuffer as ArrayBufferObject)) {
    Assert(bufferByteLength === 'detached');
    return true;
  }
  Assert(typeof bufferByteLength === 'number' && bufferByteLength >= 0);
  const byteOffsetStart = O.ByteOffset;
  let byteOffsetEnd;
  if (O.ArrayLength === 'auto') {
    byteOffsetEnd = bufferByteLength;
  } else {
    const elementSize = TypedArrayElementSize(O);
    const arrayByteLength = O.ArrayLength * elementSize;
    byteOffsetEnd = byteOffsetStart + arrayByteLength;
  }
  if (byteOffsetStart > bufferByteLength || byteOffsetEnd > bufferByteLength) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-istypedarrayfixedlength */
export function IsTypedArrayFixedLength(O: TypedArrayObject) {
  if (O.ArrayLength === 'auto') {
    return false;
  }
  const buffer = O.ViewedArrayBuffer as ArrayBufferObject;
  if (!IsFixedLengthArrayBuffer(buffer) && !IsSharedArrayBuffer(buffer)) {
    return false;
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-isvalidintegerindex */
export function IsValidIntegerIndex(O: TypedArrayObject, index: NumberValue): boolean {
  if (IsDetachedBuffer(O.ViewedArrayBuffer as ArrayBufferObject)) return false;
  if (!IsIntegralNumber(index)) return false;
  if (Object.is(index.value, -0) || index.value < 0) return false;
  const taRecord = MakeTypedArrayWithBufferWitnessRecord(O, 'seq-cst');
  if (IsTypedArrayOutOfBounds(taRecord)) return false;
  const length = TypedArrayLength(taRecord);
  if (R(index) >= length) return false;
  return true;
}

/** https://tc39.es/ecma262/#sec-typedarraygetelement */
export function TypedArrayGetElement(O: TypedArrayObject, index: NumberValue): BigIntValue | NumberValue | UndefinedValue {
  if (!IsValidIntegerIndex(O, index)) {
    return Value.undefined;
  }
  const offset = O.ByteOffset;
  const elementSize = TypedArrayElementSize(O);
  const byteIndexInBuffer = (R(index) * elementSize) + offset;
  const elementType = TypedArrayElementType(O);
  return GetValueFromBuffer(O.ViewedArrayBuffer as ArrayBufferObject, byteIndexInBuffer, elementType, true, 'unordered');
}

/** https://tc39.es/ecma262/#sec-integerindexedelementset */
export function* TypedArraySetElement(O: TypedArrayObject, index: NumberValue, value: Value): PlainEvaluator<boolean> {
  // 3. If O.[[ContentType]] is BigInt, let numValue be ? ToBigInt(value).
  // 4. Otherwise, let numValue be ? ToNumber(value).
  let numValue;
  if (O.ContentType === 'BigInt') {
    numValue = Q(yield* ToBigInt(value));
  } else {
    numValue = Q(yield* ToNumber(value));
  }
  if (IsValidIntegerIndex(O, index)) {
    const offset = O.ByteOffset;
    const elementSize = TypedArrayElementSize(O);
    const byteIndexInBuffer = (R(index) * elementSize) + offset;
    const elementType = TypedArrayElementType(O);
    Q(yield* SetValueInBuffer(O.ViewedArrayBuffer as ArrayBufferObject, byteIndexInBuffer, elementType, numValue, true, 'unordered'));
    return true;
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-isarraybufferviewoutofbounds */
export function IsArrayBufferViewOutOfBounds(O: DataViewObject | TypedArrayObject) {
  if (isDataViewObject(O)) {
    const viewRecord = MakeDataViewWithBufferWitnessRecord(O, 'seq-cst');
    return IsViewOutOfBounds(viewRecord);
  }
  const taRecord = MakeTypedArrayWithBufferWitnessRecord(O, 'seq-cst');
  return IsTypedArrayOutOfBounds(taRecord);
}
