import { Q, type ValueCompletion, type ValueEvaluator } from '../completion.mts';
import { Value, type Arguments, type FunctionCallContext } from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { DataViewObject } from './DataView.mts';
import {
  Assert,
  GetViewByteLength,
  GetViewValue,
  IsViewOutOfBounds,
  MakeDataViewWithBufferWitnessRecord,
  SetViewValue,
  RequireInternalSlot,
  F,
  Realm,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-get-dataview.prototype.buffer */
function DataViewProto_buffer(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let O be the this value.
  const O = thisValue as DataViewObject;
  // 2. Perform ? RequireInternalSlot(O, [[DataView]]).
  Q(RequireInternalSlot(O, 'DataView'));
  // 3. Assert: O has a [[ViewedArrayBuffer]] internal slot.
  Assert('ViewedArrayBuffer' in O);
  // 4. Let buffer be O.[[ViewedArrayBuffer]].
  const buffer = O.ViewedArrayBuffer;
  // 5. Return buffer.
  return buffer;
}

/** https://tc39.es/ecma262/#sec-get-dataview.prototype.bytelength */
function* DataViewProto_byteLength(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the this value.
  const O = thisValue as DataViewObject;
  // 2. Perform ? RequireInternalSlot(O, [[DataView]]).
  Q(RequireInternalSlot(O, 'DataView'));
  // 3. Assert: O has a [[ViewedArrayBuffer]] internal slot.
  Assert('ViewedArrayBuffer' in O);
  const viewRecord = MakeDataViewWithBufferWitnessRecord(O, 'seq-cst');
  if (IsViewOutOfBounds(viewRecord)) {
    return Throw.TypeError('Offset is out of bound');
  }
  const size = GetViewByteLength(viewRecord);
  return F(size);
}

/** https://tc39.es/ecma262/#sec-get-dataview.prototype.byteoffset */
function* DataViewProto_byteOffset(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let O be the this value.
  const O = thisValue as DataViewObject;
  // 2. Perform ? RequireInternalSlot(O, [[DataView]]).
  Q(RequireInternalSlot(O, 'DataView'));
  // 3. Assert: O has a [[ViewedArrayBuffer]] internal slot.
  Assert('ViewedArrayBuffer' in O);
  const viewRecord = MakeDataViewWithBufferWitnessRecord(O, 'seq-cst');
  if (IsViewOutOfBounds(viewRecord)) {
    return Throw.TypeError('Offset is out of bound');
  }
  const offset = O.ByteOffset;
  return F(offset);
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getbigint64 */
function* DataViewProto_getBigInt64([byteOffset = Value.undefined, littleEndian = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let v be the this value.
  const v = thisValue;
  // 2. Return ? GetViewValue(v, byteOffset, littleEndian, BigInt64).
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'BigInt64'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getbiguint64 */
function* DataViewProto_getBigUint64([byteOffset = Value.undefined, littleEndian = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let v be the this value.
  const v = thisValue;
  // 2. Return ? GetViewValue(v, byteOffset, littleEndian, BigUint64).
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'BigUint64'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getfloat32 */
function* DataViewProto_getFloat16([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Float16'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getfloat32 */
function* DataViewProto_getFloat32([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Float32'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getfloat64 */
function* DataViewProto_getFloat64([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Float64'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getint8 */
function* DataViewProto_getInt8([byteOffset = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  return Q(yield* GetViewValue(v, byteOffset, Value.true, 'Int8'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getint16 */
function* DataViewProto_getInt16([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Int16'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getint32 */
function* DataViewProto_getInt32([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Int32'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getuint8 */
function* DataViewProto_getUint8([byteOffset = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  return Q(yield* GetViewValue(v, byteOffset, Value.true, 'Uint8'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getuint16 */
function* DataViewProto_getUint16([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Uint16'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.getuint32 */
function* DataViewProto_getUint32([byteOffset = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  return Q(yield* GetViewValue(v, byteOffset, littleEndian, 'Uint32'));
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setbigint64 */
function* DataViewProto_setBigInt64([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let v be the this value.
  const v = thisValue;
  // 2. If littleEndian is not present, set littleEndian to undefined.
  if (littleEndian === undefined) {
    littleEndian = Value.undefined;
  }
  // 3. Return ? SetViewValue(v, byteOffset, littleEndian, BigInt64, value).
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'BigInt64', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setbiguint64 */
function* DataViewProto_setBigUint64([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let v be the this value.
  const v = thisValue;
  // 2. If littleEndian is not present, set littleEndian to undefined.
  if (littleEndian === undefined) {
    littleEndian = Value.undefined;
  }
  // 3. Return ? SetViewValue(v, byteOffset, littleEndian, BigUint64, value).
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'BigUint64', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setfloat32 */
function* DataViewProto_setFloat16([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Float16', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setfloat32 */
function* DataViewProto_setFloat32([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Float32', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setfloat64 */
function* DataViewProto_setFloat64([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Float64', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setint8 */
function* DataViewProto_setInt8([byteOffset = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  Q(yield* SetViewValue(v, byteOffset, Value.true, 'Int8', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setint16 */
function* DataViewProto_setInt16([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Int16', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setint32 */
function* DataViewProto_setInt32([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Int32', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setuint8 */
function* DataViewProto_setUint8([byteOffset = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  Q(yield* SetViewValue(v, byteOffset, Value.true, 'Uint8', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setuint16 */
function* DataViewProto_setUint16([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Uint16', value));
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-dataview.prototype.setuint32 */
function* DataViewProto_setUint32([byteOffset = Value.undefined, value = Value.undefined, littleEndian]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const v = thisValue;
  if (littleEndian === undefined) {
    littleEndian = Value.false;
  }
  Q(yield* SetViewValue(v, byteOffset, littleEndian, 'Uint32', value));
  return Value.undefined;
}

export function bootstrapDataViewPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['buffer', [DataViewProto_buffer]],
    ['byteLength', [DataViewProto_byteLength]],
    ['byteOffset', [DataViewProto_byteOffset]],
    ['getBigInt64', DataViewProto_getBigInt64, 1],
    ['getBigUint64', DataViewProto_getBigUint64, 1],
    ['getFloat16', DataViewProto_getFloat16, 1],
    ['getFloat32', DataViewProto_getFloat32, 1],
    ['getFloat64', DataViewProto_getFloat64, 1],
    ['getInt8', DataViewProto_getInt8, 1],
    ['getInt16', DataViewProto_getInt16, 1],
    ['getInt32', DataViewProto_getInt32, 1],
    ['getUint8', DataViewProto_getUint8, 1],
    ['getUint16', DataViewProto_getUint16, 1],
    ['getUint32', DataViewProto_getUint32, 1],
    ['setBigInt64', DataViewProto_setBigInt64, 2],
    ['setBigUint64', DataViewProto_setBigUint64, 2],
    ['setFloat16', DataViewProto_setFloat16, 2],
    ['setFloat32', DataViewProto_setFloat32, 2],
    ['setFloat64', DataViewProto_setFloat64, 2],
    ['setInt8', DataViewProto_setInt8, 2],
    ['setInt16', DataViewProto_setInt16, 2],
    ['setInt32', DataViewProto_setInt32, 2],
    ['setUint8', DataViewProto_setUint8, 2],
    ['setUint16', DataViewProto_setUint16, 2],
    ['setUint32', DataViewProto_setUint32, 2],
  ], realmRec.Intrinsics['%Object.prototype%'], 'DataView');

  realmRec.Intrinsics['%DataView.prototype%'] = proto;
}
