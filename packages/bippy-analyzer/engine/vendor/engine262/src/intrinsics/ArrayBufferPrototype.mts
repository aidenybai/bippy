import {
  Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { surroundingAgent } from '#self';
import {
  RequireInternalSlot, IsDetachedBuffer, IsSharedArrayBuffer, ToClampedIndex,
  SpeciesConstructor, Construct, SameValue, CopyDataBlockBytes,
  F,
  type ArrayBufferObject,
  type ResizableArrayBufferObject,
  type Mutable,
  CreateByteDataBlock,
  ToIndex,
  HostResizeArrayBuffer,
  IsFixedLengthArrayBuffer,
  ArrayBufferCopyAndDetach,
  Realm,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-get-arraybuffer.prototype.bytelength */
function ArrayBufferProto_byteLength(_args: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Let O be this value.
  const O = thisValue as ArrayBufferObject;
  // 2. Perform ? RequireInternalSlot(O, [[ArrayBufferData]]).
  Q(RequireInternalSlot(O, 'ArrayBufferData'));
  // 3. If IsSharedArrayBuffer(O) is true, throw a TypeError exception.
  if (IsSharedArrayBuffer(O)) {
    return Throw.TypeError('Attempt to access shared ArrayBuffer');
  }
  // 4. If IsDetachedBuffer(O) is true, return +0𝔽.
  if (IsDetachedBuffer(O)) {
    return F(+0);
  }
  // 5. Let length be O.[[ArrayBufferByteLength]].
  const length = O.ArrayBufferByteLength;
  // 6. Return length.
  return F(length);
}

/** https://tc39.es/ecma262/#sec-get-arraybuffer.prototype.detached */
function ArrayBufferProto_detached(_args: Arguments, { thisValue }: FunctionCallContext) {
  const O = thisValue as ArrayBufferObject;
  Q(RequireInternalSlot(O, 'ArrayBufferData'));
  if (IsSharedArrayBuffer(O)) {
    return Throw.TypeError('Invalid call to ArrayBuffer.prototype.detached on shared ArrayBuffer');
  }
  return Value(IsDetachedBuffer(O));
}

/** https://tc39.es/ecma262/#sec-get-arraybuffer.prototype.maxbytelength */
function ArrayBufferProto_maxByteLength(_args: Arguments, { thisValue }: FunctionCallContext) {
  const O = thisValue as ArrayBufferObject;
  Q(RequireInternalSlot(O, 'ArrayBufferData'));
  if (IsSharedArrayBuffer(O)) {
    return Throw.TypeError('Invalid call to ArrayBuffer.prototype.maxByteLength on shared ArrayBuffer');
  }
  if (IsDetachedBuffer(O)) {
    return F(+0);
  }
  if (IsFixedLengthArrayBuffer(O)) {
    return F(O.ArrayBufferByteLength);
  }
  return F((O as ResizableArrayBufferObject).ArrayBufferMaxByteLength);
}

/** https://tc39.es/ecma262/#sec-get-arraybuffer.prototype.resizable */
function ArrayBufferProto_resizable(_args: Arguments, { thisValue }: FunctionCallContext) {
  const O = thisValue as ArrayBufferObject;
  Q(RequireInternalSlot(O, 'ArrayBufferData'));
  if (IsSharedArrayBuffer(O)) {
    return Throw.TypeError('Invalid call to ArrayBuffer.prototype.resizable on shared ArrayBuffer');
  }
  return Value(!IsFixedLengthArrayBuffer(O));
}

/** https://tc39.es/ecma262/#sec-arraybuffer.prototype.resize */
function* ArrayBufferProto_resize([newLength = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  const obj = thisValue as Mutable<ResizableArrayBufferObject>;
  Q(RequireInternalSlot(obj, 'ArrayBufferMaxByteLength'));
  if (IsSharedArrayBuffer(obj)) {
    return Throw.TypeError('Invalid call to ArrayBuffer.prototype.resize on shared ArrayBuffer');
  }
  const newByteLength = Q(yield* ToIndex(newLength));
  if (IsDetachedBuffer(obj)) {
    return Throw.TypeError('Invalid call to ArrayBuffer.prototype.resize on detached ArrayBuffer');
  }
  if (newByteLength > obj.ArrayBufferMaxByteLength) {
    return Throw.RangeError('Cannot resize ArrayBuffer to bigger than maxByteLength');
  }
  Q(surroundingAgent.debugger_cannotPreview);
  const hostHandled = HostResizeArrayBuffer(obj, newByteLength);
  if (hostHandled === 'handled') {
    return Value.undefined;
  }
  const oldBlock = obj.ArrayBufferData!;
  const newBlock = Q(CreateByteDataBlock(newByteLength));
  const copyLength = Math.min(newByteLength, obj.ArrayBufferByteLength);
  CopyDataBlockBytes(newBlock, 0, oldBlock, 0, copyLength);
  obj.ArrayBufferData = newBlock;
  obj.ArrayBufferByteLength = newByteLength;
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-arraybuffer.prototype.slice */
function* ArrayBufferProto_slice([start = Value.undefined, end = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  // 1. Let O be the this value.
  const O = thisValue as ArrayBufferObject;
  // 2. Perform ? RequireInternalSlot(O, [[ArrayBufferData]]).
  Q(RequireInternalSlot(O, 'ArrayBufferData'));
  // 3. If IsSharedArrayBuffer(O) is true, throw a TypeError exception.
  if (IsSharedArrayBuffer(O)) {
    return Throw.TypeError('Attempt to access shared ArrayBuffer');
  }
  // 4. If IsDetachedBuffer(O) is true, throw a TypeError exception.
  if (IsDetachedBuffer(O)) {
    return Throw.TypeError('Attempt to access detached ArrayBuffer');
  }
  // 5. Let len be O.[[ArrayBufferByteLength]].
  const length = O.ArrayBufferByteLength;
  // 6. Let relativeStart be ? ToIntegerOrInfinity(start).
  const first = Q(yield* ToClampedIndex(start, length));
  const final = end === Value.undefined ? length : Q(yield* ToClampedIndex(end, length));
  // 10. Let newLen be max(final - first, 0).
  const newLen = Math.max(final - first, 0);
  // 11. Let ctor be ? SpeciesConstructor(O, %ArrayBuffer%).
  const ctor = Q(yield* SpeciesConstructor(O, surroundingAgent.intrinsic('%ArrayBuffer%')));
  // 12. Let new be ? Construct(ctor, « newLen »).
  const newO = Q(yield* Construct(ctor, [F(newLen)])) as ArrayBufferObject;
  // 13. Perform ? RequireInternalSlot(new, [[ArrayBufferData]]).
  Q(RequireInternalSlot(newO, 'ArrayBufferData'));
  // 14. If IsSharedArrayBuffer(new) is true, throw a TypeError exception.
  if (IsSharedArrayBuffer(newO)) {
    return Throw.TypeError('Attempt to access shared ArrayBuffer');
  }
  // 15. If IsDetachedBuffer(new) is true, throw a TypeError exception.
  if (IsDetachedBuffer(newO)) {
    return Throw.TypeError('Attempt to access detached ArrayBuffer');
  }
  // 16. If SameValue(new, O) is true, throw a TypeError exception.
  if (SameValue(newO, O)) {
    return Throw.TypeError('Subclass constructor returned the same object $1', newO);
  }
  // 17. If new.[[ArrayBufferByteLength]] < newLen, throw a TypeError exception.
  if (newO.ArrayBufferByteLength < newLen) {
    return Throw.TypeError('Subclass constructor returned a smaller-than-requested object $1', newO);
  }
  // 18. NOTE: Side-effects of the above steps may have detached O.
  // 19. If IsDetachedBuffer(O) is true, throw a TypeError exception.
  if (IsDetachedBuffer(O)) {
    return Throw.TypeError('Attempt to access detached ArrayBuffer');
  }
  const fromBuf = O.ArrayBufferData!;
  const toBuf = newO.ArrayBufferData!;
  const currentLen = O.ArrayBufferByteLength;
  const maxCount = currentLen - first;
  if (maxCount > 0) {
    const count = Math.min(newLen, maxCount);
    CopyDataBlockBytes(toBuf, 0, fromBuf, first, count);
  }
  return newO;
}

/** https://tc39.es/ecma262/#sec-arraybuffer.prototype.transfer */
function* ArrayBufferProto_transfer([newLength = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  return yield* ArrayBufferCopyAndDetach(thisValue, newLength, 'preserve-resizability');
}

/** https://tc39.es/ecma262/#sec-arraybuffer.prototype.transfertofixedlength */
function* ArrayBufferProto_transferToFixedLength([newLength = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  return yield* ArrayBufferCopyAndDetach(thisValue, newLength, 'fixed-length');
}

export function bootstrapArrayBufferPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['byteLength', [ArrayBufferProto_byteLength]],
    ['detached', [ArrayBufferProto_detached]],
    ['maxByteLength', [ArrayBufferProto_maxByteLength]],
    ['resizable', [ArrayBufferProto_resizable]],
    ['resize', ArrayBufferProto_resize, 1],
    ['slice', ArrayBufferProto_slice, 2],
    ['transfer', ArrayBufferProto_transfer, 0],
    ['transferToFixedLength', ArrayBufferProto_transferToFixedLength, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'ArrayBuffer');

  realmRec.Intrinsics['%ArrayBuffer.prototype%'] = proto;
}
