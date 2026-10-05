import {
  Descriptor,
} from '../value.mts';
import { X } from '../completion.mts';
import {
  ObjectValue, type BuiltinFunctionObject, type FunctionObject
  ,
} from '../index.mts';
import type { Realm } from '../execution-context/Realm.mts';
import {
  Assert,
  DefinePropertyOrThrow,
} from './all.mts';

/** https://tc39.es/ecma262/#table-well-known-intrinsic-objects */
export interface Intrinsics_Table6 {
  '%AbstractModuleSource%': FunctionObject;
  '%AggregateError%': FunctionObject;
  '%AsyncDisposableStack%': FunctionObject;
  '%Array%': FunctionObject;
  '%ArrayBuffer%': FunctionObject;
  '%ArrayIteratorPrototype%': ObjectValue;
  '%AsyncFromSyncIteratorPrototype%': ObjectValue;
  '%AsyncFunction%': FunctionObject;
  '%AsyncGeneratorFunction%': FunctionObject;
  '%AsyncGeneratorPrototype%': ObjectValue;
  '%AsyncIteratorPrototype%': ObjectValue;
  '%Atomics%': ObjectValue;
  '%BigInt%': FunctionObject;
  '%BigInt64Array%': FunctionObject;
  '%BigUint64Array%': FunctionObject;
  '%Boolean%': FunctionObject;
  '%DataView%': FunctionObject;
  '%Date%': FunctionObject;
  '%DisposableStack%': FunctionObject;
  '%decodeURI%': FunctionObject;
  '%decodeURIComponent%': FunctionObject;
  '%encodeURI%': FunctionObject;
  '%encodeURIComponent%': FunctionObject;
  '%Error%': FunctionObject;
  '%eval%': FunctionObject;
  '%EvalError%': FunctionObject;
  '%FinalizationRegistry%': FunctionObject;
  '%Float16Array%': FunctionObject;
  '%Float32Array%': FunctionObject;
  '%Float64Array%': FunctionObject;
  '%ForInIteratorPrototype%': ObjectValue;
  '%Function%': FunctionObject;
  '%GeneratorFunction%': FunctionObject;
  '%GeneratorPrototype%': ObjectValue;
  '%Int8Array%': FunctionObject;
  '%Int16Array%': FunctionObject;
  '%Int32Array%': FunctionObject;
  '%isFinite%': FunctionObject;
  '%isNaN%': FunctionObject;
  '%Iterator%': FunctionObject;
  '%IteratorHelperPrototype%': ObjectValue;
  '%JSON%': ObjectValue;
  '%Map%': FunctionObject;
  '%MapIteratorPrototype%': ObjectValue;
  '%Math%': ObjectValue;
  '%Number%': FunctionObject;
  '%Object%': FunctionObject;
  '%parseFloat%': FunctionObject;
  '%parseInt%': FunctionObject;
  '%Promise%': FunctionObject;
  '%Proxy%': FunctionObject;
  '%RangeError%': FunctionObject;
  '%ReferenceError%': FunctionObject;
  '%Reflect%': ObjectValue;
  '%RegExp%': FunctionObject;
  '%RegExpStringIteratorPrototype%': ObjectValue;
  '%Set%': FunctionObject;
  '%SetIteratorPrototype%': ObjectValue;
  '%SharedArrayBuffer%': FunctionObject;
  '%String%': FunctionObject;
  '%StringIteratorPrototype%': ObjectValue;
  '%Symbol%': FunctionObject;
  '%SuppressedError%': FunctionObject;
  '%SyntaxError%': FunctionObject;
  '%ThrowTypeError%': FunctionObject;
  '%TypedArray%': FunctionObject;
  '%TypeError%': FunctionObject;
  '%Uint8Array%': FunctionObject;
  '%Uint8ClampedArray%': FunctionObject;
  '%Uint16Array%': FunctionObject;
  '%Uint32Array%': FunctionObject;
  '%URIError%': FunctionObject;
  '%WeakMap%': FunctionObject;
  '%WeakRef%': FunctionObject;
  '%WeakSet%': FunctionObject;
  '%WrapForValidIteratorPrototype%': ObjectValue;
}
export interface Intrinsics extends Intrinsics_Table6 {
  '%AbstractModuleSource.prototype%': ObjectValue;
  '%AggregateError.prototype%': ObjectValue;
  '%Array.prototype.values%': FunctionObject;
  '%Array.prototype%': ObjectValue;
  '%ArrayBuffer.prototype%': ObjectValue;
  '%AsyncDisposableStack.prototype%': ObjectValue;
  '%AsyncFunction.prototype%': ObjectValue;
  '%AsyncGeneratorFunction.prototype.prototype%': ObjectValue;
  '%AsyncGeneratorFunction.prototype%': ObjectValue;
  '%BigInt.prototype%': ObjectValue;
  '%BigInt64Array.prototype%': ObjectValue;
  '%BigInt64Array%': FunctionObject;
  '%BigUint64Array.prototype%': ObjectValue;
  '%BigUint64Array%': FunctionObject;
  '%Boolean.prototype%': ObjectValue;
  '%DataView.prototype%': ObjectValue;
  '%Date.prototype%': ObjectValue;
  '%DisposableStack.prototype%': ObjectValue;
  '%Error.prototype%': ObjectValue;
  '%Error.prototype.toString%': BuiltinFunctionObject;
  '%EvalError.prototype%': ObjectValue;
  '%EvalError%': FunctionObject;
  '%FinalizationRegistry.prototype%': ObjectValue;
  '%Float16Array.prototype%': ObjectValue;
  '%Float32Array.prototype%': ObjectValue;
  '%Float32Array%': FunctionObject;
  '%Float64Array.prototype%': ObjectValue;
  '%Float64Array%': FunctionObject;
  '%Function.prototype%': FunctionObject;
  '%GeneratorFunction.prototype.prototype.next%': FunctionObject;
  '%GeneratorFunction.prototype.prototype%': ObjectValue;
  '%GeneratorFunction.prototype%': ObjectValue;
  '%Int16Array.prototype%': ObjectValue;
  '%Int16Array%': FunctionObject;
  '%Int32Array.prototype%': ObjectValue;
  '%Int32Array%': FunctionObject;
  '%Int8Array.prototype%': ObjectValue;
  '%Int8Array%': FunctionObject;
  '%Iterator.prototype%': ObjectValue;
  '%JSON.parse%': FunctionObject;
  '%JSON.stringify%': FunctionObject;
  '%Map.prototype%': ObjectValue;
  '%Number.prototype%': ObjectValue;
  '%Object.prototype.toString%': BuiltinFunctionObject;
  '%Object.prototype.valueOf%': FunctionObject;
  '%Object.prototype%': ObjectValue;
  '%Promise.prototype.then%': FunctionObject;
  '%Promise.prototype%': ObjectValue;
  '%Promise.resolve%': FunctionObject;
  '%RangeError.prototype%': ObjectValue;
  '%RangeError%': FunctionObject;
  '%ReferenceError.prototype%': ObjectValue;
  '%ReferenceError%': FunctionObject;
  '%RegExp.prototype%': ObjectValue;
  '%Set.prototype%': ObjectValue;
  '%ShadowRealm%': FunctionObject;
  '%ShadowRealm.prototype%': ObjectValue;
  '%String.prototype%': ObjectValue;
  // Note: do not add any well known symbols here, use wellKnownSymbols.*
  '%Symbol.prototype%': ObjectValue;
  '%SuppressedError.prototype%': ObjectValue;
  '%SyntaxError.prototype%': ObjectValue;
  '%SyntaxError%': FunctionObject;
  '%Temporal%': ObjectValue;
  '%Temporal.Duration%': FunctionObject;
  '%Temporal.Duration.prototype%': ObjectValue;
  '%Temporal.Instant%': FunctionObject;
  '%Temporal.Instant.prototype%': ObjectValue;
  '%Temporal.PlainDate%': FunctionObject;
  '%Temporal.PlainDate.prototype%': ObjectValue;
  '%Temporal.PlainDateTime%': FunctionObject;
  '%Temporal.PlainDateTime.prototype%': ObjectValue;
  '%Temporal.PlainMonthDay%': FunctionObject;
  '%Temporal.PlainMonthDay.prototype%': ObjectValue;
  '%Temporal.PlainYearMonth%': FunctionObject;
  '%Temporal.PlainYearMonth.prototype%': ObjectValue;
  '%Temporal.PlainTime%': FunctionObject;
  '%Temporal.PlainTime.prototype%': ObjectValue;
  '%Temporal.ZonedDateTime%': FunctionObject;
  '%Temporal.ZonedDateTime.prototype%': ObjectValue;
  '%TypedArray.prototype%': ObjectValue;
  '%TypeError.prototype%': ObjectValue;
  '%TypeError%': FunctionObject;
  '%Uint16Array.prototype%': ObjectValue;
  '%Uint16Array%': FunctionObject;
  '%Uint32Array.prototype%': ObjectValue;
  '%Uint32Array%': FunctionObject;
  '%Uint8Array.prototype%': ObjectValue;
  '%Uint8Array%': FunctionObject;
  '%Uint8ClampedArray.prototype%': ObjectValue;
  '%Uint8ClampedArray%': FunctionObject;
  '%URIError.prototype%': ObjectValue;
  '%URIError%': FunctionObject;
  '%WeakMap.prototype%': ObjectValue;
  '%WeakRef.prototype%': ObjectValue;
  '%WeakSet.prototype%': ObjectValue;
}

export function AddRestrictedFunctionProperties(F: ObjectValue, realm: Realm) {
  Assert(!!realm.Intrinsics['%ThrowTypeError%']);
  const thrower = realm.Intrinsics['%ThrowTypeError%'];
  X(DefinePropertyOrThrow(F, 'caller', Descriptor({
    Get: thrower,
    Set: thrower,
    Enumerable: false,
    Configurable: true,
  })));
  X(DefinePropertyOrThrow(F, 'arguments', Descriptor({
    Get: thrower,
    Set: thrower,
    Enumerable: false,
    Configurable: true,
  })));
}
