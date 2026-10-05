import { typedArrayInfoByType, type TypedArrayTypes } from '../intrinsics/TypedArray.mts';
import {
  decodeFloat16,
  decodeFloat32,
  decodeFloat64,
  encodeFloat16,
  encodeFloat32,
  encodeFloat64,
} from '../host-defined/ieee754.mts';
import { IsGrowableSharedArrayBuffer, sharedArrayBufferNotSupported } from './shared-arraybuffer.mts';
import {
  surroundingAgent,
  NumberValue, BigIntValue, Value,
  DataBlock,
  Q, X, type ValueEvaluator,
  type Mutable,
  Assert, OrdinaryCreateFromConstructor,
  isNonNegativeInteger, CreateByteDataBlock,
  SameValue,
  CopyDataBlockBytes,
  RequireInternalSlot,
  F,
  Z,
  type FunctionObject,
  type OrdinaryObject,
  ObjectValue,
  Throw,
  R,
  Get,
  ToIndex,
  type PlainEvaluator,
} from '#self';

export interface ArrayBufferObject extends OrdinaryObject {
  readonly ArrayBufferData: DataBlock | null;
  readonly ArrayBufferByteLength: number;
  readonly ArrayBufferDetachKey: Value | undefined;
}

export interface ResizableArrayBufferObject extends ArrayBufferObject {
  readonly ArrayBufferMaxByteLength: number;
}

export function isArrayBufferObject(o: Value): o is ArrayBufferObject {
  return 'ArrayBufferDetachKey' in o;
}

/** https://tc39.es/ecma262/#sec-allocatearraybuffer */
export function* AllocateArrayBuffer(constructor: FunctionObject, byteLength: number, maxByteLength?: number): ValueEvaluator<ArrayBufferObject> {
  const slots = ['ArrayBufferData', 'ArrayBufferByteLength', 'ArrayBufferDetachKey'];
  let allocatingResizableBuffer;
  if (maxByteLength !== undefined) {
    allocatingResizableBuffer = true;
  } else {
    allocatingResizableBuffer = false;
  }
  if (allocatingResizableBuffer) {
    if (byteLength > maxByteLength!) {
      return Throw.RangeError('Cannot resize ArrayBuffer to bigger than maxByteLength');
    }
    slots.push('ArrayBufferMaxByteLength');
  }
  const obj = Q(yield* OrdinaryCreateFromConstructor(constructor, '%ArrayBuffer.prototype%', slots)) as Mutable<ArrayBufferObject & ResizableArrayBufferObject>;
  // 2. Assert: byteLength is a non-negative integer.
  Assert(isNonNegativeInteger(byteLength));
  // 3. Let block be ? CreateByteDataBlock(byteLength).
  const block = Q(CreateByteDataBlock(byteLength, maxByteLength));
  // 4. Set obj.[[ArrayBufferData]] to block.
  obj.ArrayBufferData = block;
  // 5. Set obj.[[ArrayBufferByteLength]] to byteLength.
  obj.ArrayBufferByteLength = byteLength;
  if (allocatingResizableBuffer) {
    // a. If it is not possible to create a Data Block block consisting of maxByteLength bytes, throw a RangeError exception.
    if (maxByteLength! > (surroundingAgent.hostDefinedOptions?.resizableArrayBufferMaxByteLength ?? 0xFFFF_FFFF)) {
      return Throw.RangeError('Cannot allocate memory');
    }
    obj.ArrayBufferMaxByteLength = maxByteLength!;
  }
  return obj;
}

/** https://tc39.es/ecma262/#sec-arraybufferbytelength */
export function ArrayBufferByteLength(arrayBuffer: ArrayBufferObject, _order: 'seq-cst' | 'unordered'): number {
  if (IsGrowableSharedArrayBuffer(arrayBuffer)) {
    sharedArrayBufferNotSupported();
  }
  Assert(!IsDetachedBuffer(arrayBuffer));
  return arrayBuffer.ArrayBufferByteLength;
}

/** https://tc39.es/ecma262/#sec-arraybuffercopyanddetach */
export function* ArrayBufferCopyAndDetach(
  _arrayBuffer: Value,
  newLength: Value,
  preserveResizability: 'preserve-resizability' | 'fixed-length',
): ValueEvaluator<ArrayBufferObject> {
  Q(RequireInternalSlot(_arrayBuffer, 'ArrayBufferData'));
  const arrayBuffer = _arrayBuffer as Mutable<ArrayBufferObject>;
  if (IsSharedArrayBuffer(arrayBuffer)) {
    return Throw.TypeError('Attempt to access shared ArrayBuffer');
  }

  let newByteLength;
  if (newLength === Value.undefined) {
    newByteLength = arrayBuffer.ArrayBufferByteLength;
  } else {
    newByteLength = Q(yield* ToIndex(newLength));
  }

  if (IsDetachedBuffer(arrayBuffer)) {
    return Throw.TypeError('Attempt to access detached ArrayBuffer');
  }

  let newMaxByteLength;
  if (preserveResizability === 'preserve-resizability' && !IsFixedLengthArrayBuffer(arrayBuffer)) {
    newMaxByteLength = (arrayBuffer as ResizableArrayBufferObject).ArrayBufferMaxByteLength;
  }

  if (arrayBuffer.ArrayBufferDetachKey !== undefined) {
    return Throw.TypeError('Cannot transfer ArrayBuffer with custom detach key');
  }

  const newBuffer = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), newByteLength, newMaxByteLength));
  const copyLength = Math.min(newByteLength, arrayBuffer.ArrayBufferByteLength);
  const fromBlock = arrayBuffer.ArrayBufferData!;
  const toBlock = newBuffer.ArrayBufferData!;
  CopyDataBlockBytes(toBlock, 0, fromBlock, 0, copyLength);
  X(DetachArrayBuffer(arrayBuffer));
  return newBuffer;
}

/** https://tc39.es/ecma262/#sec-isdetachedbuffer */
export function IsDetachedBuffer(arrayBuffer: ArrayBufferObject) {
  if (!arrayBuffer.ArrayBufferData) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-detacharraybuffer */
export function DetachArrayBuffer(arrayBuffer: Mutable<ArrayBufferObject>, key?: Value) {
  // 2. Assert: IsSharedArrayBuffer(arrayBuffer) is false.
  Assert(!IsSharedArrayBuffer(arrayBuffer));
  // 4. If SameValue(arrayBuffer.[[ArrayBufferDetachKey]], key) is false, throw a TypeError exception.
  if (arrayBuffer.ArrayBufferDetachKey === undefined
      ? key !== undefined
      : key === undefined || !SameValue(arrayBuffer.ArrayBufferDetachKey, key)) {
    return Throw.TypeError('$1 is not the [[ArrayBufferDetachKey]] of the given ArrayBuffer', key ?? Value.undefined);
  }
  Q(surroundingAgent.debugger_tryTouchDuringPreview(arrayBuffer));
  // 5. Set arrayBuffer.[[ArrayBufferData]] to null.
  arrayBuffer.ArrayBufferData = null;
  // 6. Set arrayBuffer.[[ArrayBufferByteLength]] to 0.
  arrayBuffer.ArrayBufferByteLength = 0;
  return undefined;
}

/** https://tc39.es/ecma262/#sec-issharedarraybuffer */
export function IsSharedArrayBuffer(_obj: Value) {
  return false;
}

export function* CloneArrayBuffer(srcBuffer: ArrayBufferObject, srcByteOffset: number, srcLength: number): ValueEvaluator<ArrayBufferObject> {
  Assert(!IsDetachedBuffer(srcBuffer));
  const targetBuffer = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), srcLength));
  const srcBlock = srcBuffer.ArrayBufferData!;
  const targetBlock = targetBuffer.ArrayBufferData!;
  CopyDataBlockBytes(targetBlock, 0, srcBlock, srcByteOffset, srcLength);
  return targetBuffer;
}

/** https://tc39.es/ecma262/#sec-getarraybuffermaxbytelengthoption */
export function* GetArrayBufferMaxByteLengthOption(options: Value): PlainEvaluator<number | undefined> {
  if (!(options instanceof ObjectValue)) {
    return undefined;
  }
  const maxByteLength = Q(yield* Get(options, 'maxByteLength'));
  if (maxByteLength === Value.undefined) {
    return undefined;
  }
  return Q(yield* ToIndex(maxByteLength));
}

/** https://tc39.es/ecma262/#sec-hostresizearraybuffer */
export function HostResizeArrayBuffer(buffer: ArrayBufferObject, newByteLength: number): 'handled' | 'unhandled' {
  const f = surroundingAgent.hostDefinedOptions.hostHooks?.HostResizeArrayBuffer || (() => {
    const block = buffer.ArrayBufferData!.buffer;
    if (!block.resizable) return 'unhandled';
    try {
      block.resize(newByteLength);
      return 'handled';
    } catch {
      return 'unhandled';
    }
  });
  const result = f?.(buffer, newByteLength) ?? 'unhandled';
  if (result === 'handled') {
    (buffer as Mutable<ArrayBufferObject>).ArrayBufferByteLength = newByteLength;
  }
  return result;
}

/** https://tc39.es/ecma262/#sec-isfixedlengtharraybuffer */
export function IsFixedLengthArrayBuffer(arrayBuffer: ArrayBufferObject) {
  return !('ArrayBufferMaxByteLength' in arrayBuffer);
}

/** https://tc39.es/ecma262/#sec-isunsignedelementtype */
export function IsUnsignedElementType(type: TypedArrayTypes) {
  if (type === 'Uint8' || type === 'Uint8C' || type === 'Uint16' || type === 'Uint32' || type === 'BigUint64') return true;
  return false;
}

// TODO: IsUnclampedIntegerElementType

/** https://tc39.es/ecma262/#sec-isbigintelementtype */
export function IsBigIntElementType(type: TypedArrayTypes) {
  if (type === 'BigUint64' || type === 'BigInt64') return true;
  return false;
}

// TODO: IsNoTearConfiguration

/** https://tc39.es/ecma262/#sec-rawbytestonumeric */
export function RawBytesToNumeric(type: TypedArrayTypes, rawBytes: readonly number[], isLittleEndian: boolean) {
  const elementSize = typedArrayInfoByType[type].ElementSize;
  rawBytes = isLittleEndian ? rawBytes : rawBytes.toReversed();

  if (type === 'Float16') {
    return F(decodeFloat16(rawBytes));
  }
  if (type === 'Float32') {
    return F(decodeFloat32(rawBytes));
  }
  if (type === 'Float64') {
    return F(decodeFloat64(rawBytes));
  }

  // If IsUnsignedElementType(type) is true, then
  //     Let intValue be the byte elements of rawBytes concatenated and interpreted as a bit string encoding of an unsigned little-endian binary number.
  // Else,
  //     Let intValue be the byte elements of rawBytes concatenated and interpreted as a bit string encoding of a binary little-endian two's complement number of bit length elementSize × 8.
  const isUnsigned = IsUnsignedElementType(type);
  const bits = BigInt(elementSize * 8);
  let intValue = 0n;
  for (let i = 0; i < rawBytes.length; i += 1) {
    intValue |= BigInt(rawBytes[i]!) << BigInt(i * 8);
  }

  if (!isUnsigned) {
    const signBit = 1n << (bits - 1n);
    if ((intValue & signBit) !== 0n) {
      intValue -= 1n << bits;
    }
  }

  return IsBigIntElementType(type) ? Z(intValue) : F(Number(intValue));
}

// TODO: GetRawBytesFromSharedBlock

/** https://tc39.es/ecma262/#sec-getvaluefrombuffer */
export function GetValueFromBuffer(arrayBuffer: ArrayBufferObject, byteIndex: number, type: TypedArrayTypes, _isTypedArray: boolean, _order: 'unordered', isLittleEndian?: boolean) {
  // 1. Assert: IsDetachedBuffer(arrayBuffer) is false.
  Assert(!IsDetachedBuffer(arrayBuffer));
  // 2. Assert: There are sufficient bytes in arrayBuffer starting at byteIndex to represent a value of type.
  // 3. Assert: byteIndex is a non-negative integer.
  Assert(isNonNegativeInteger(byteIndex));
  // 4. Let block be arrayBuffer.[[ArrayBufferData]].
  const block = arrayBuffer.ArrayBufferData!;
  // 5. Let elementSize be the Element Size value specified in Table 61 for Element Type type.
  const elementSize = typedArrayInfoByType[type].ElementSize;
  // 6. If IsSharedArrayBuffer(arrayBuffer) is true, then
  if (IsSharedArrayBuffer(arrayBuffer)) {
    sharedArrayBufferNotSupported();
  }
  // 7. Else, let rawValue be a List of elementSize containing, in order, the elementSize sequence of bytes starting with block[byteIndex].
  const rawValue = [...block.subarray(byteIndex, byteIndex + elementSize)];
  // 8. If isLittleEndian is not present, set isLittleEndian to the value of the [[LittleEndian]] field of the surrounding agent's Agent Record.
  if (isLittleEndian === undefined) {
    const AR = surroundingAgent.AgentRecord;
    isLittleEndian = AR.LittleEndian;
  }
  // 9. Return RawBytesToNumeric(type, rawValue, isLittleEndian).
  return RawBytesToNumeric(type, rawValue, isLittleEndian);
}

/** https://tc39.es/ecma262/#sec-numerictorawbytes */
export function NumericToRawBytes(type: TypedArrayTypes, value: NumberValue | BigIntValue, isLittleEndian: boolean) {
  let rawBytes: number[];
  if (type === 'Float16') {
    rawBytes = encodeFloat16(Number(value.value));
  } else if (type === 'Float32') {
    rawBytes = encodeFloat32(Number(value.value));
  } else if (type === 'Float64') {
    rawBytes = encodeFloat64(Number(value.value));
  } else {
    const conversionOperation = typedArrayInfoByType[type].ConversionOperation as (argument: Value) => PlainEvaluator<NumberValue | BigIntValue | bigint | number>;
    const converted = X(conversionOperation(value));
    const intValue = R(typeof converted === 'bigint' || typeof converted === 'number' ? Value(converted) : converted);
    // If intValue ≥ 0, then
    //     Let rawBytes be a List whose elements are the n-byte binary encoding of intValue. The bytes are ordered in little endian order.
    // Else,
    //     Let rawBytes be a List whose elements are the n-byte binary two's complement encoding of intValue. The bytes are ordered in little endian order.
    const byteCount = typedArrayInfoByType[type].ElementSize;
    const mod = 1n << BigInt(byteCount * 8);
    let bits = typeof intValue === 'bigint' ? intValue : BigInt(intValue);
    if (bits < 0) {
      bits += mod;
    }

    const nextRawBytes = new Array<number>(byteCount);
    for (let i = 0; i < byteCount; i += 1) {
      nextRawBytes[i] = Number((bits >> BigInt(i * 8)) & 0xFFn);
    }
    rawBytes = nextRawBytes;
  }
  if (isLittleEndian) return rawBytes;
  return rawBytes.toReversed();
}

/** https://tc39.es/ecma262/#sec-setvalueinbuffer */
export function* SetValueInBuffer(arrayBuffer: ArrayBufferObject, byteIndex: number, type: TypedArrayTypes, value: BigIntValue | NumberValue, _isTypedArray: boolean, _order: 'seq-cst' | 'unordered' | 'init', isLittleEndian?: boolean): PlainEvaluator<void> {
  // 1. Assert: IsDetachedBuffer(arrayBuffer) is false.
  Assert(!IsDetachedBuffer(arrayBuffer));
  // 2. Assert: There are sufficient bytes in arrayBuffer starting at byteIndex to represent a value of type.
  // 3. Assert: byteIndex is a non-negative integer.
  Assert(isNonNegativeInteger(byteIndex));
  // 4. Assert: Type(value) is BigInt if IsBigIntElementType(type) is true; otherwise, Type(value) is Number.
  if (IsBigIntElementType(type)) {
    Assert(value instanceof BigIntValue);
  } else {
    Assert(value instanceof NumberValue);
  }
  // 5. Let block be arrayBuffer.[[ArrayBufferData]].
  const block = arrayBuffer.ArrayBufferData!;
  // 6. Let elementSize be the Element Size value specified in Table 61 for Element Type type.
  // const elementSize = typedArrayInfoByType[type].ElementSize;
  // 7. If isLittleEndian is not present, set isLittleEndian to the value of the [[LittleEndian]] field of the surrounding agent's Agent Record.
  if (isLittleEndian === undefined) {
    const AR = surroundingAgent.AgentRecord;
    isLittleEndian = AR.LittleEndian;
  }
  // 8. Let rawBytes be NumericToRawBytes(type, value, isLittleEndian).
  const rawBytes = NumericToRawBytes(type, value, isLittleEndian);
  // 9. If IsSharedArrayBuffer(arrayBuffer) is true, then
  if (IsSharedArrayBuffer(arrayBuffer)) {
    sharedArrayBufferNotSupported();
  }
  // 10. Else, store the individual bytes of rawBytes into block, in order, starting at block[byteIndex].
  Q(surroundingAgent.debugger_tryTouchDuringPreview(arrayBuffer));
  rawBytes.forEach((byte, i) => {
    block[byteIndex + i] = byte;
  });
  // 11. Return NormalCompletion(undefined).
}

// TODO: GetModifySetValueInBuffer
