import {
  BigIntValue,
  DataBlock,
  Descriptor,
  NumberValue,
  ObjectValue,
  UndefinedValue,
  Value,
} from '../value.mts';
import { Q, X } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import type { Decimal } from '../host-defined/decimal.mts';
import {
  Assert,
  CreateDataProperty,
  Get,
  HasProperty,
  IsCallable,
  OrdinaryObjectCreate,
  ToBoolean,
  type FunctionObject,
} from './all.mts';
import { isNonNegativeInteger } from './data-types-and-values.mts';
import { surroundingAgent, Throw, type AccessorDescriptorInit, type DataDescriptorInit, type Mutable } from '#self';

/** https://tc39.es/ecma262/#mathematical-value */
export type MathematicalValue = Decimal;
/** https://tc39.es/ecma262/#extended-mathematical-value */
export type ExtendedMathematicalValue = MathematicalValue | 'Inf' | '-Inf';
/** https://tc39.es/ecma262/#sec-ecmascript-language-types-number-type */
export type Num = number;
export type F = Num;
/** https://tc39.es/ecma262/#sec-ecmascript-language-types-bigint-type */
export type BigInts = bigint & { /** @internal */ type?: 'bigint' };
/** https://tc39.es/ecma262/#integer */
export type Integer = bigint & { /** @internal */ type?: 'integer' };
/** https://tc39.es/ecma262/#integral-number */
export type IntegralNumber = Num & { /** @internal */ integral?: true; /** @internal */ finite?: true };
export type NaN = Num & { /** @internal */ integral?: false; /** @internal */ finite?: false; /** @internal */ value: 'NaN' };

// #𝔽
export function F(x: number): NumberValue {
  Assert(typeof x === 'number');
  return Value(x);
}

// #ℤ
export function Z(x: bigint): BigIntValue {
  Assert(typeof x === 'bigint');
  return Value(x);
}

// #ℝ
export function R(x: NumberValue): number;
export function R(x: BigIntValue): bigint;
export function R(x: BigIntValue | NumberValue): bigint | number;
export function R(x: unknown) {
  if (x instanceof BigIntValue) {
    return x.bigintValue(); // eslint-disable-line @engine262/mathematical-value
  }
  Assert(x instanceof NumberValue);
  const number = x.numberValue(); // eslint-disable-line @engine262/mathematical-value
  if (Object.is(number, -0)) {
    return 0;
  }
  return number;
}

/** https://tc39.es/ecma262/#sec-isaccessordescriptor */
export interface AccessorDescriptor extends Descriptor {
  readonly Get: FunctionObject | UndefinedValue;
  readonly Set: FunctionObject | UndefinedValue;
}

/** https://tc39.es/ecma262/#sec-isaccessordescriptor */
export function IsAccessorDescriptor(propertyDesc: Descriptor): propertyDesc is AccessorDescriptor {
  if (propertyDesc.Get !== undefined) return true;
  if (propertyDesc.Set !== undefined) return true;
  return false;
}

/** https://tc39.es/ecma262/#sec-isdatadescriptor */
export interface DataDescriptor extends Descriptor {
  readonly Value: Value;
  readonly Writable: boolean;
}

/** https://tc39.es/ecma262/#sec-isdatadescriptor */
export function IsDataDescriptor(propertyDesc: Descriptor): propertyDesc is DataDescriptor {
  if (propertyDesc.Value !== undefined) return true;
  if (propertyDesc.Writable !== undefined) return true;
  return false;
}

export interface GenericDescriptor extends Descriptor {
  readonly Get?: never;
  readonly Set?: never;
  readonly Value?: never;
  readonly Writable?: never;
}

/** https://tc39.es/ecma262/#sec-isgenericdescriptor */
export function IsGenericDescriptor(propertyDesc: Descriptor): propertyDesc is GenericDescriptor {
  if (IsDataDescriptor(propertyDesc)) return false;
  if (IsAccessorDescriptor(propertyDesc)) return false;
  return true;
}

export interface FullyPopulatedDataDescriptor extends DataDescriptor {
  readonly Configurable: boolean;
  readonly Enumerable: boolean;
  readonly Writable: boolean;
}

export interface FullyPopulatedAccessorDescriptor extends AccessorDescriptor {
  readonly Configurable: boolean;
  readonly Enumerable: boolean;
}

/** https://tc39.es/ecma262/#sec-property-descriptor-specification-type */
export type FullyPopulatedDescriptor = FullyPopulatedDataDescriptor | FullyPopulatedAccessorDescriptor;

/** https://tc39.es/ecma262/#sec-frompropertydescriptor */
export function FromPropertyDescriptor(propertyDesc: Descriptor | undefined) {
  if (propertyDesc === undefined) {
    return Value.undefined;
  }
  const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  if (propertyDesc.Value !== undefined) {
    X(CreateDataProperty(obj, 'value', propertyDesc.Value));
  }
  if (propertyDesc.Writable !== undefined) {
    X(CreateDataProperty(obj, 'writable', Value(propertyDesc.Writable)));
  }
  if (propertyDesc.Get !== undefined) {
    X(CreateDataProperty(obj, 'get', propertyDesc.Get));
  }
  if (propertyDesc.Set !== undefined) {
    X(CreateDataProperty(obj, 'set', propertyDesc.Set));
  }
  if (propertyDesc.Enumerable !== undefined) {
    X(CreateDataProperty(obj, 'enumerable', Value(propertyDesc.Enumerable)));
  }
  if (propertyDesc.Configurable !== undefined) {
    X(CreateDataProperty(obj, 'configurable', Value(propertyDesc.Configurable)));
  }
  // Assert: All of the above CreateDataProperty operations return true.
  return obj;
}

/** https://tc39.es/ecma262/#sec-topropertydescriptor */
export function* ToPropertyDescriptor(Obj: Value): PlainEvaluator<Descriptor> {
  if (!(Obj instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', Obj);
  }

  const desc = {} as Mutable<AccessorDescriptorInit & DataDescriptorInit>;
  const hasEnumerable = Q(yield* HasProperty(Obj, 'enumerable'));
  if (hasEnumerable) {
    const enumerable = ToBoolean(Q(yield* Get(Obj, 'enumerable')));
    desc.Enumerable = enumerable;
  }
  const hasConfigurable = Q(yield* HasProperty(Obj, 'configurable'));
  if (hasConfigurable) {
    const conf = ToBoolean(Q(yield* Get(Obj, 'configurable')));
    desc.Configurable = conf;
  }
  const hasValue = Q(yield* HasProperty(Obj, 'value'));
  if (hasValue) {
    const value = Q(yield* Get(Obj, 'value'));
    desc.Value = value;
  }
  const hasWritable = Q(yield* HasProperty(Obj, 'writable'));
  if (hasWritable) {
    const writable = ToBoolean(Q(yield* Get(Obj, 'writable')));
    desc.Writable = writable;
  }
  const hasGet = Q(yield* HasProperty(Obj, 'get'));
  if (hasGet) {
    const getter = Q(yield* Get(Obj, 'get'));
    if (!IsCallable(getter) && !(getter instanceof UndefinedValue)) {
      return Throw.TypeError('getter ($1) in a property descriptor $2 must be a function', getter, Obj);
    }
    desc.Get = getter as FunctionObject;
  }
  const hasSet = Q(yield* HasProperty(Obj, 'set'));
  if (hasSet) {
    const setter = Q(yield* Get(Obj, 'set'));
    if (!IsCallable(setter) && !(setter instanceof UndefinedValue)) {
      return Throw.TypeError('setter ($1) in a property descriptor $2 must be a function', setter, Obj);
    }
    desc.Set = setter as FunctionObject;
  }
  if (desc.Get !== undefined || desc.Set !== undefined) {
    if (desc.Value !== undefined || desc.Writable !== undefined) {
      return Throw.TypeError('Property descriptors must not specify both accessors and a value or writable attribute, but $1 does', Obj);
    }
  }
  return Descriptor(desc);
}

/** https://tc39.es/ecma262/#sec-completepropertydescriptor */
export function CompletePropertyDescriptor(propertyDesc: Descriptor) {
  const like = {
    Value: Value.undefined,
    Writable: false,
    Get: Value.undefined,
    Set: Value.undefined,
    Enumerable: false,
    Configurable: false,
  };
  if (IsGenericDescriptor(propertyDesc) || IsDataDescriptor(propertyDesc)) {
    if (propertyDesc.Value === undefined) propertyDesc = Descriptor({ ...propertyDesc, Value: like.Value });
    if (propertyDesc.Writable === undefined) propertyDesc = Descriptor({ ...propertyDesc, Writable: like.Writable });
  } else {
    if (propertyDesc.Get === undefined) propertyDesc = Descriptor({ ...propertyDesc, Get: like.Get });
    if (propertyDesc.Set === undefined) propertyDesc = Descriptor({ ...propertyDesc, Set: like.Set });
  }
  if (propertyDesc.Enumerable === undefined) propertyDesc = Descriptor({ ...propertyDesc, Enumerable: like.Enumerable });
  if (propertyDesc.Configurable === undefined) propertyDesc = Descriptor({ ...propertyDesc, Configurable: like.Configurable });
  return propertyDesc;
}

/** @internal */
export let hostSupportResizableArrayBuffer = false;

/** https://tc39.es/ecma262/#sec-createbytedatablock */
export function CreateByteDataBlock(size: number, _notInSpecMaxByteLength?: number | undefined) {
  Assert(isNonNegativeInteger(size));
  if (size > 2 ** 53 - 1) {
    return Throw.RangeError('Invalid length');
  }
  let db;
  try {
    const buffer = new ArrayBuffer(size, {
      get maxByteLength() {
        hostSupportResizableArrayBuffer = true;
        return _notInSpecMaxByteLength;
      },
    });
    db = new DataBlock(buffer);
  } catch (err) {
    return Throw.RangeError('Cannot allocate memory');
  }
  return db;
}

/** https://tc39.es/ecma262/#sec-copydatablockbytes */
export function CopyDataBlockBytes(toBlock: DataBlock, toIndex: number, fromBlock: DataBlock, fromIndex: number, count: number) {
  Assert(fromBlock !== toBlock);
  Assert(Number.isSafeInteger(fromIndex) && fromIndex >= 0);
  Assert(Number.isSafeInteger(toIndex) && toIndex >= 0);
  Assert(Number.isSafeInteger(count) && count >= 0);
  const fromSize = fromBlock.byteLength;
  Assert(fromIndex + count <= fromSize);
  const toSize = toBlock.byteLength;
  Assert(toIndex + count <= toSize);
  while (count > 0) {
    toBlock[toIndex] = fromBlock[fromIndex];
    toIndex += 1;
    fromIndex += 1;
    count -= 1;
  }
}
