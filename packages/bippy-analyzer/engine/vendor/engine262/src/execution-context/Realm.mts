import { AddRestrictedFunctionProperties, type Intrinsics } from '../abstract-ops/realms.mts';
import { bootstrapAggregateError } from '../intrinsics/AggregateError.mts';
import { bootstrapAggregateErrorPrototype } from '../intrinsics/AggregateErrorPrototype.mts';
import { bootstrapAbstractModuleSource } from '../intrinsics/AbstractModuleSource.mts';
import { bootstrapArray } from '../intrinsics/Array.mts';
import { bootstrapArrayBuffer } from '../intrinsics/ArrayBuffer.mts';
import { bootstrapArrayBufferPrototype } from '../intrinsics/ArrayBufferPrototype.mts';
import { bootstrapArrayIteratorPrototype } from '../intrinsics/ArrayIteratorPrototype.mts';
import { bootstrapArrayPrototype } from '../intrinsics/ArrayPrototype.mts';
import { bootstrapAsyncFromSyncIteratorPrototype } from '../intrinsics/AsyncFromSyncIteratorPrototype.mts';
import { bootstrapAsyncFunction } from '../intrinsics/AsyncFunction.mts';
import { bootstrapAsyncFunctionPrototype } from '../intrinsics/AsyncFunctionPrototype.mts';
import { bootstrapAsyncGeneratorFunction } from '../intrinsics/AsyncGeneratorFunction.mts';
import { bootstrapAsyncGeneratorFunctionPrototype } from '../intrinsics/AsyncGeneratorFunctionPrototype.mts';
import { bootstrapAsyncGeneratorFunctionPrototypePrototype } from '../intrinsics/AsyncGeneratorFunctionPrototypePrototype.mts';
import { bootstrapAsyncIteratorPrototype } from '../intrinsics/AsyncIteratorPrototype.mts';
import { bootstrapAsyncDisposableStack } from '../intrinsics/AsyncDisposableStack.mts';
import { bootstrapAsyncDisposableStackPrototype } from '../intrinsics/AsyncDisposableStackPrototype.mts';
import { bootstrapBigInt } from '../intrinsics/BigInt.mts';
import { bootstrapBigIntPrototype } from '../intrinsics/BigIntPrototype.mts';
import { bootstrapBoolean } from '../intrinsics/Boolean.mts';
import { bootstrapBooleanPrototype } from '../intrinsics/BooleanPrototype.mts';
import { bootstrapDataView } from '../intrinsics/DataView.mts';
import { bootstrapDataViewPrototype } from '../intrinsics/DataViewPrototype.mts';
import { bootstrapDate } from '../intrinsics/Date.mts';
import { bootstrapDatePrototype } from '../intrinsics/DatePrototype.mts';
import { bootstrapDisposableStack } from '../intrinsics/DisposableStack.mts';
import { bootstrapDisposableStackPrototype } from '../intrinsics/DisposableStackPrototype.mts';
import { bootstrapError } from '../intrinsics/Error.mts';
import { bootstrapErrorPrototype } from '../intrinsics/ErrorPrototype.mts';
import { bootstrapEval } from '../intrinsics/eval.mts';
import { bootstrapFinalizationRegistry } from '../intrinsics/FinalizationRegistry.mts';
import { bootstrapFinalizationRegistryPrototype } from '../intrinsics/FinalizationRegistryPrototype.mts';
import { bootstrapForInIteratorPrototype } from '../intrinsics/ForInIteratorPrototype.mts';
import { bootstrapFunction } from '../intrinsics/Function.mts';
import { bootstrapFunctionPrototype } from '../intrinsics/FunctionPrototype.mts';
import { bootstrapGeneratorFunction } from '../intrinsics/GeneratorFunction.mts';
import { bootstrapGeneratorFunctionPrototype } from '../intrinsics/GeneratorFunctionPrototype.mts';
import { bootstrapGeneratorFunctionPrototypePrototype } from '../intrinsics/GeneratorFunctionPrototypePrototype.mts';
import { bootstrapIsFinite } from '../intrinsics/isFinite.mts';
import { bootstrapIsNaN } from '../intrinsics/isNaN.mts';
import { bootstrapIterator } from '../intrinsics/Iterator.mts';
import { bootstrapIteratorHelperPrototype } from '../intrinsics/IteratorHelperPrototype.mts';
import { bootstrapIteratorPrototype } from '../intrinsics/IteratorPrototype.mts';
import { bootstrapJSON } from '../intrinsics/JSON.mts';
import { bootstrapMap } from '../intrinsics/Map.mts';
import { bootstrapMapIteratorPrototype } from '../intrinsics/MapIteratorPrototype.mts';
import { bootstrapMapPrototype } from '../intrinsics/MapPrototype.mts';
import { bootstrapMath } from '../intrinsics/Math.mts';
import { bootstrapNativeError } from '../intrinsics/NativeError.mts';
import { bootstrapNumber } from '../intrinsics/Number.mts';
import { bootstrapNumberPrototype } from '../intrinsics/NumberPrototype.mts';
import { bootstrapObject } from '../intrinsics/Object.mts';
import { makeObjectPrototype, bootstrapObjectPrototype } from '../intrinsics/ObjectPrototype.mts';
import { bootstrapParseFloat } from '../intrinsics/parseFloat.mts';
import { bootstrapParseInt } from '../intrinsics/parseInt.mts';
import { bootstrapPromise } from '../intrinsics/Promise.mts';
import { bootstrapPromisePrototype } from '../intrinsics/PromisePrototype.mts';
import { bootstrapProxy } from '../intrinsics/Proxy.mts';
import { bootstrapReflect } from '../intrinsics/Reflect.mts';
import { bootstrapRegExp } from '../intrinsics/RegExp.mts';
import { bootstrapRegExpPrototype } from '../intrinsics/RegExpPrototype.mts';
import { bootstrapRegExpStringIteratorPrototype } from '../intrinsics/RegExpStringIteratorPrototype.mts';
import { bootstrapSet } from '../intrinsics/Set.mts';
import { bootstrapSetIteratorPrototype } from '../intrinsics/SetIteratorPrototype.mts';
import { bootstrapSetPrototype } from '../intrinsics/SetPrototype.mts';
import { bootstrapShadowRealm } from '../intrinsics/ShadowRealm.mts';
import { bootstrapShadowRealmPrototype } from '../intrinsics/ShadowRealmPrototype.mts';
import { bootstrapString } from '../intrinsics/String.mts';
import { bootstrapStringIteratorPrototype } from '../intrinsics/StringIteratorPrototype.mts';
import { bootstrapStringPrototype } from '../intrinsics/StringPrototype.mts';
import { bootstrapSymbol } from '../intrinsics/Symbol.mts';
import { bootstrapSymbolPrototype } from '../intrinsics/SymbolPrototype.mts';
import { bootstrapSuppressedError } from '../intrinsics/SuppressedError.mts';
import { bootstrapSuppressedErrorPrototype } from '../intrinsics/SuppressedErrorPrototype.mts';
import { bootstrapThrowTypeError } from '../intrinsics/ThrowTypeError.mts';
import { bootstrapTypedArray } from '../intrinsics/TypedArray.mts';
import { bootstrapUint8Array } from '../intrinsics/TypedArray_Uint8Array.mts';
import { bootstrapTypedArrayConstructors } from '../intrinsics/TypedArrayConstructors.mts';
import { bootstrapTypedArrayPrototype } from '../intrinsics/TypedArrayPrototype.mts';
import { bootstrapTypedArrayPrototypes } from '../intrinsics/TypedArrayPrototypes.mts';
import { bootstrapURIHandling } from '../intrinsics/URIHandling.mts';
import { bootstrapWeakMap } from '../intrinsics/WeakMap.mts';
import { bootstrapWeakMapPrototype } from '../intrinsics/WeakMapPrototype.mts';
import { bootstrapWeakRef } from '../intrinsics/WeakRef.mts';
import { bootstrapWeakRefPrototype } from '../intrinsics/WeakRefPrototype.mts';
import { bootstrapWeakSet } from '../intrinsics/WeakSet.mts';
import { bootstrapWeakSetPrototype } from '../intrinsics/WeakSetPrototype.mts';
import { bootstrapWrapForValidIteratorPrototype } from '../intrinsics/WrapForValidIteratorPrototype.mts';
import { bootstrapTemporal } from '../intrinsics/Temporal/Temporal.mts';
import {
  type ObjectValue, type GlobalEnvironmentRecord, type ParseNode, type LoadedModuleRequestRecord, type ManagedRealmHostDefined, type GCMarker,
  ManagedRealm,
  type Mutable,
  DefinePropertyOrThrow,
  Descriptor,
  F as toNumberValue,
  Value,
  X,
} from '#self';

/** https://tc39.es/ecma262/#sec-code-realms */
export abstract class Realm {
  abstract readonly AgentSignifier: unknown;

  abstract readonly Intrinsics: Intrinsics;

  abstract readonly GlobalObject: ObjectValue;

  abstract readonly GlobalEnv: GlobalEnvironmentRecord;

  abstract readonly TemplateMap: { Site: ParseNode.TemplateLiteral; Array: ObjectValue; }[];

  readonly LoadedModules: LoadedModuleRequestRecord[] = [];

  abstract readonly HostDefined: ManagedRealmHostDefined;

  // NON-SPEC
  abstract randomState: undefined | BigUint64Array;

  mark(m: GCMarker) {
    m(this.GlobalObject);
    m(this.GlobalEnv);
    for (const v of Object.values(this.Intrinsics)) {
      m(v);
    }
    for (const v of Object.values(this.TemplateMap)) {
      m(v);
    }
    for (const v of this.LoadedModules) {
      m(v.Module);
    }
  }
}

/** https://tc39.es/ecma262/pr/3728/#sec-makerealm */
export function MakeRealm(...args: ConstructorParameters<typeof ManagedRealm>) {
  return new ManagedRealm(...args).topContext;
}

/** https://tc39.es/ecma262/#sec-createintrinsics */
export function CreateIntrinsics(realmRec: Realm) {
  const intrinsics = Object.create(null);
  (realmRec as Mutable<Realm>).Intrinsics = intrinsics;
  makeObjectPrototype(realmRec);

  bootstrapFunctionPrototype(realmRec);
  bootstrapObjectPrototype(realmRec);
  bootstrapThrowTypeError(realmRec);

  bootstrapEval(realmRec);
  bootstrapIsFinite(realmRec);
  bootstrapIsNaN(realmRec);
  bootstrapParseFloat(realmRec);
  bootstrapParseInt(realmRec);
  bootstrapURIHandling(realmRec);

  bootstrapObject(realmRec);

  bootstrapErrorPrototype(realmRec);
  bootstrapError(realmRec);
  bootstrapNativeError(realmRec);
  bootstrapAggregateErrorPrototype(realmRec);
  bootstrapAggregateError(realmRec);
  bootstrapSuppressedErrorPrototype(realmRec);
  bootstrapSuppressedError(realmRec);

  bootstrapFunction(realmRec);
  bootstrapAbstractModuleSource(realmRec);

  bootstrapIteratorPrototype(realmRec);
  bootstrapIterator(realmRec);
  bootstrapIteratorHelperPrototype(realmRec);
  bootstrapWrapForValidIteratorPrototype(realmRec);

  bootstrapAsyncIteratorPrototype(realmRec);
  bootstrapDisposableStackPrototype(realmRec);
  bootstrapDisposableStack(realmRec);
  bootstrapAsyncDisposableStackPrototype(realmRec);
  bootstrapAsyncDisposableStack(realmRec);
  bootstrapArrayIteratorPrototype(realmRec);
  bootstrapMapIteratorPrototype(realmRec);
  bootstrapSetIteratorPrototype(realmRec);
  bootstrapStringIteratorPrototype(realmRec);
  bootstrapRegExpStringIteratorPrototype(realmRec);
  bootstrapForInIteratorPrototype(realmRec);

  bootstrapStringPrototype(realmRec);
  bootstrapString(realmRec);

  bootstrapArrayPrototype(realmRec);
  bootstrapArray(realmRec);

  bootstrapBooleanPrototype(realmRec);
  bootstrapBoolean(realmRec);

  bootstrapNumberPrototype(realmRec);
  bootstrapNumber(realmRec);

  bootstrapBigIntPrototype(realmRec);
  bootstrapBigInt(realmRec);

  bootstrapSymbolPrototype(realmRec);
  bootstrapSymbol(realmRec);

  bootstrapPromisePrototype(realmRec);
  bootstrapPromise(realmRec);

  bootstrapProxy(realmRec);

  bootstrapReflect(realmRec);

  bootstrapMath(realmRec);

  bootstrapDatePrototype(realmRec);
  bootstrapDate(realmRec);

  bootstrapRegExpPrototype(realmRec);
  bootstrapRegExp(realmRec);

  bootstrapSetPrototype(realmRec);
  bootstrapSet(realmRec);

  bootstrapMapPrototype(realmRec);
  bootstrapMap(realmRec);

  bootstrapGeneratorFunctionPrototypePrototype(realmRec);
  bootstrapGeneratorFunctionPrototype(realmRec);
  bootstrapGeneratorFunction(realmRec);

  bootstrapAsyncFunctionPrototype(realmRec);
  bootstrapAsyncFunction(realmRec);

  bootstrapAsyncGeneratorFunctionPrototypePrototype(realmRec);
  bootstrapAsyncGeneratorFunctionPrototype(realmRec);
  bootstrapAsyncGeneratorFunction(realmRec);

  bootstrapAsyncFromSyncIteratorPrototype(realmRec);

  bootstrapArrayBufferPrototype(realmRec);
  bootstrapArrayBuffer(realmRec);

  bootstrapTypedArrayPrototype(realmRec);
  bootstrapTypedArray(realmRec);
  bootstrapTypedArrayPrototypes(realmRec);
  bootstrapTypedArrayConstructors(realmRec);
  bootstrapUint8Array(realmRec);

  bootstrapDataViewPrototype(realmRec);
  bootstrapDataView(realmRec);

  bootstrapJSON(realmRec);

  bootstrapWeakMapPrototype(realmRec);
  bootstrapWeakMap(realmRec);
  bootstrapWeakSetPrototype(realmRec);
  bootstrapWeakSet(realmRec);

  bootstrapWeakRefPrototype(realmRec);
  bootstrapWeakRef(realmRec);

  bootstrapFinalizationRegistryPrototype(realmRec);
  bootstrapFinalizationRegistry(realmRec);

  bootstrapShadowRealmPrototype(realmRec);
  bootstrapShadowRealm(realmRec);

  bootstrapTemporal(realmRec);

  AddRestrictedFunctionProperties(intrinsics['%Function.prototype%'], realmRec);

  return intrinsics;
}

/** https://tc39.es/ecma262/#sec-setdefaultglobalbindings */
export function SetDefaultGlobalBindings(realmRec: Realm) {
  const global = realmRec.GlobalObject;

  // Value Properties of the Global Object
  for (const [name, value] of [
    ['Infinity', toNumberValue(Infinity)],
    ['NaN', toNumberValue(NaN)],
    ['undefined', Value.undefined],
  ] as const) {
    X(DefinePropertyOrThrow(global, Value(name), Descriptor({
      Value: value,
      Writable: false,
      Enumerable: false,
      Configurable: false,
    })));
  }

  X(DefinePropertyOrThrow(global, 'globalThis', Descriptor({
    Value: realmRec.GlobalEnv.GlobalThisValue,
    Writable: true,
    Enumerable: false,
    Configurable: true,
  })));

  for (const name of [
    // Function Properties of the Global Object
    'eval',
    'isFinite',
    'isNaN',
    'parseFloat',
    'parseInt',
    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',

    // Constructor Properties of the Global Object
    'AggregateError',
    'AsyncDisposableStack',
    'Array',
    'ArrayBuffer',
    'Boolean',
    'BigInt',
    'BigInt64Array',
    'BigUint64Array',
    'DataView',
    'Date',
    'DisposableStack',
    'Error',
    'EvalError',
    'FinalizationRegistry',
    'Float16Array',
    'Float32Array',
    'Float64Array',
    'Function',
    'Int8Array',
    'Int16Array',
    'Int32Array',
    'Iterator',
    'Map',
    'Number',
    'Object',
    'Promise',
    'Proxy',
    'RangeError',
    'ReferenceError',
    'RegExp',
    'Set',
    'ShadowRealm',
    // 'SharedArrayBuffer',
    'String',
    'Symbol',
    'SuppressedError',
    'SyntaxError',
    'Temporal',
    'TypeError',
    'Uint8Array',
    'Uint8ClampedArray',
    'Uint16Array',
    'Uint32Array',
    'URIError',
    'WeakMap',
    'WeakRef',
    'WeakSet',

    // Other Properties of the Global Object
    // 'Atomics',
    'JSON',
    'Math',
    'Reflect',
  ] as const) {
    const value = realmRec.Intrinsics[`%${name}%`];
    if (!value) {
      continue;
    }
    X(DefinePropertyOrThrow(global, Value(name), Descriptor({
      Value: value,
      Writable: true,
      Enumerable: false,
      Configurable: true,
    })));
  }
}
