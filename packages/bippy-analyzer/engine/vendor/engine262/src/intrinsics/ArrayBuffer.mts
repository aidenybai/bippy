import {
  ObjectValue, UndefinedValue, Value, wellKnownSymbols, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q } from '../completion.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  ToIndex, AllocateArrayBuffer, type FunctionObject,
  GetArrayBufferMaxByteLengthOption,
  Throw,
  Realm,
} from '#self';

/** https://tc39.es/ecma262/#sec-arraybuffer-length */
function* ArrayBufferConstructor(this: FunctionObject, [length = Value.undefined, options = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  if (NewTarget instanceof UndefinedValue) {
    return Throw.TypeError('ArrayBuffer cannot be invoked without new');
  }
  const byteLength = Q(yield* ToIndex(length));
  const requestedMaxByteLength = Q(yield* GetArrayBufferMaxByteLengthOption(options));
  return Q(yield* AllocateArrayBuffer(NewTarget, byteLength, requestedMaxByteLength));
}

/** https://tc39.es/ecma262/#sec-arraybuffer.isview */
function ArrayBuffer_isView([arg = Value.undefined]: Arguments) {
  // 1. If Type(arg) is not Object, return false.
  if (!(arg instanceof ObjectValue)) {
    return Value.false;
  }
  // 2. If arg has a [[ViewedArrayBuffer]] internal slot, return true.
  if ('ViewedArrayBuffer' in arg) {
    return Value.true;
  }
  // 3. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-get-arraybuffer-@@species */
function ArrayBuffer_species(_: Arguments, { thisValue }: FunctionCallContext) {
  return thisValue;
}

export function bootstrapArrayBuffer(realmRec: Realm) {
  const c = bootstrapConstructor(realmRec, ArrayBufferConstructor, 'ArrayBuffer', 1, realmRec.Intrinsics['%ArrayBuffer.prototype%'], [
    ['isView', ArrayBuffer_isView, 1],
    [wellKnownSymbols.species, [ArrayBuffer_species]],
  ]);
  realmRec.Intrinsics['%ArrayBuffer%'] = c;
}
