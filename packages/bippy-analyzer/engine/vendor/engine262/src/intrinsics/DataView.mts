import {
  UndefinedValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q } from '../completion.mts';
import { __ts_cast__, type Mutable } from '../utils/language.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  IsDetachedBuffer,
  ArrayBufferByteLength,
  IsFixedLengthArrayBuffer,
  OrdinaryCreateFromConstructor,
  ToIndex,
  RequireInternalSlot,
  type OrdinaryObject,
  type FunctionObject,
  type ArrayBufferObject,
  Realm,
  Throw,
  Assert,
} from '#self';

/** https://tc39.es/ecma262/#sec-dataview-objects */
export interface DataViewObject extends OrdinaryObject {
  readonly DataView: string;
  readonly ViewedArrayBuffer: Value;
  readonly ByteLength: number | 'auto';
  readonly ByteOffset: number;
}
export function isDataViewObject(V: Value): V is DataViewObject {
  return 'DataView' in V;
}
/** https://tc39.es/ecma262/#sec-dataview-constructor */
function* DataViewConstructor(this: FunctionObject, [buffer = Value.undefined, byteOffset = Value.undefined, byteLength = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('DataView cannot be invoked without new');
  }
  Q(RequireInternalSlot(buffer, 'ArrayBufferData'));
  const offset = Q(yield* ToIndex(byteOffset));
  __ts_cast__<ArrayBufferObject>(buffer);
  if (IsDetachedBuffer(buffer)) {
    return Throw.TypeError('Attempt to access detached ArrayBuffer');
  }
  let bufferByteLength = ArrayBufferByteLength(buffer, 'seq-cst');
  if (offset > bufferByteLength) {
    return Throw.RangeError('Offset is outside the bounds of the DataView');
  }
  const bufferIsFixedLength = IsFixedLengthArrayBuffer(buffer);
  let viewByteLength: DataViewObject['ByteLength'];
  if (byteLength === Value.undefined) {
    viewByteLength = bufferIsFixedLength ? bufferByteLength - offset : 'auto';
  } else {
    viewByteLength = Q(yield* ToIndex(byteLength));
    if (offset + viewByteLength > bufferByteLength) {
      return Throw.RangeError('Offset is outside the bounds of the DataView');
    }
  }
  const O = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%DataView.prototype%', ['DataView', 'ViewedArrayBuffer', 'ByteLength', 'ByteOffset'])) as Mutable<DataViewObject>;
  if (IsDetachedBuffer(buffer)) {
    return Throw.TypeError('Attempt to access detached ArrayBuffer');
  }
  bufferByteLength = ArrayBufferByteLength(buffer, 'seq-cst');
  if (offset > bufferByteLength) {
    return Throw.RangeError('Offset is outside the bounds of the DataView');
  }
  if (byteLength !== Value.undefined) {
    Assert(typeof viewByteLength === 'number');
    if (offset + viewByteLength > bufferByteLength) {
      return Throw.RangeError('Offset is outside the bounds of the DataView');
    }
  }
  O.ViewedArrayBuffer = buffer;
  O.ByteLength = viewByteLength;
  O.ByteOffset = offset;
  return O;
}

export function bootstrapDataView(realmRec: Realm) {
  const dvConstructor = bootstrapConstructor(realmRec, DataViewConstructor, 'DataView', 1, realmRec.Intrinsics['%DataView.prototype%'], []);

  realmRec.Intrinsics['%DataView%'] = dvConstructor;
}
