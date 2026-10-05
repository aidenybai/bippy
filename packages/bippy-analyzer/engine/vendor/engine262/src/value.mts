import { type GCMarker } from './host-defined/engine.mts';
import {
  Q, X, type ValueEvaluator, type PlainCompletion,
} from './completion.mts';
import { OutOfRange, callable } from './utils/language.mts';
import { PropertyKeyMap } from './utils/container.mts';
import type { PrivateElementRecord } from './runtime-semantics/MethodDefinitionEvaluation.mts';
import type { PlainEvaluator } from './evaluator.mts';
import {
  OrdinaryDefineOwnProperty,
  OrdinaryDelete,
  OrdinaryGet,
  OrdinaryGetOwnProperty,
  OrdinaryGetPrototypeOf,
  OrdinaryHasProperty,
  OrdinaryIsExtensible,
  OrdinaryOwnPropertyKeys,
  OrdinaryPreventExtensions,
  OrdinarySet,
  OrdinarySetPrototypeOf,
  ToInt32,
  ToUint32,
  Z,
  F, R, type OrdinaryObject, type FunctionObject,
  type BuiltinFunctionObject,
  type ECMAScriptFunctionObject,
  type DefaultConstructorBuiltinFunction, EnvironmentRecord,
  Throw,
  surroundingAgent,
  type Integer,
  type FullyPopulatedDescriptor,
  type AccessorDescriptor,
  type FullyPopulatedDataDescriptor,
  type GenericDescriptor,
  type DataDescriptor,
  type FullyPopulatedAccessorDescriptor,
} from '#self';

let createStringValue: (value: string) => JSStringValue; // set by static block in StringValue for privileged access to constructor
let createNumberValue: (value: number) => NumberValue; // set by static block in NumberValue for privileged access to constructor
let createBigIntValue: (value: bigint) => BigIntValue; // set by static block in BigIntValue for privileged access to constructor

export abstract class BaseValue {
  static declare readonly null: NullValue; // defined in static block of NullValue

  static declare readonly undefined: UndefinedValue; // defined in static block of UndefinedValue

  static declare readonly true: BooleanValue<true>; // defined in static block of BooleanValue

  static declare readonly false: BooleanValue<false>; // defined in static block of BooleanValue

  abstract type: Value['type']; // ensures new `Value` subtypes must be added to `Value` union

  declare static [Symbol.hasInstance]: (value: unknown) => value is Value; // no need to actually declare it.
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export type Value =
  | UndefinedValue
  | NullValue
  | BooleanValue
  | JSStringValue
  | SymbolValue
  | NumberValue
  | BigIntValue
  | ObjectValue;

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export const Value = (() => {
  // NOTE: Using IIFE so that the class does not conflict with the type of the same name
  @callable((_target, _thisArg, [value]) => {
    if (value === null) {
      return Value.null;
    } else if (value === undefined) {
      return Value.undefined;
    } else if (value === true) {
      return Value.true;
    } else if (value === false) {
      return Value.false;
    }
    switch (typeof value) {
      case 'string':
        return createStringValue(value);
      case 'number':
        return createNumberValue(value);
      case 'bigint':
        return createBigIntValue(value);
      default:
        throw OutOfRange.nonExhaustive(value);
    }
  })
  abstract class Value extends BaseValue {
  }
  return Value;
})() as typeof BaseValue & {
  <T extends null | undefined | boolean | string | number | bigint>(value: T):
    T extends null ? NullValue :
    T extends undefined ? UndefinedValue :
    T extends boolean ? BooleanValue<T> :
    T extends string ? JSStringValue :
    T extends number ? NumberValue :
    T extends bigint ? BigIntValue :
    never;
};

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export type PropertyKeyValue =
  | JSStringValue
  | SymbolValue;

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export type PrimitiveValue =
  | UndefinedValue
  | NullValue
  | BooleanValue
  | JSStringValue
  | SymbolValue
  | NumberValue
  | BigIntValue;

/** https://tc39.es/ecma262/#sec-ecmascript-language-types */
export const PrimitiveValue = (() => {
  type PrimValue = PrimitiveValue;
  return (() => {
    // NOTE: Using nested IIFE so that the class does not conflict with the type of the same name
    // NOTE: Only using IIFE because TypeScript errors when `abstract` is used on class expressions
    abstract class PrimitiveValue extends Value {
      declare static [Symbol.hasInstance]: (value: unknown) => value is PrimValue;
    }
    return PrimitiveValue;
  })();
})();

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-undefined-type */
export class UndefinedValue extends PrimitiveValue {
  declare readonly type: 'Undefined'; // defined on prototype by static block

  declare readonly value: undefined; // defined on prototype by static block

  private constructor() { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super();
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Undefined' });
    Object.defineProperty(this.prototype, 'value', { value: undefined });
    Object.defineProperty(Value, 'undefined', { value: new this() });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is UndefinedValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-null-type */
export class NullValue extends PrimitiveValue {
  declare readonly type: 'Null'; // defined on prototype by static block

  declare readonly value: null; // defined on prototype by static block

  private constructor() { // eslint-disable-line no-useless-constructor -- Sets privacy for constructor
    super();
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Null' });
    Object.defineProperty(this.prototype, 'value', { value: null });
    Object.defineProperty(Value, 'null', { value: new this() });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is NullValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-boolean-type */
export class BooleanValue<T extends boolean = boolean> extends PrimitiveValue {
  declare readonly type: 'Boolean'; // defined on prototype by static block

  readonly value: T;

  private constructor(value: T) {
    super();
    this.value = value;
  }

  booleanValue() {
    return this.value;
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Boolean { ${this.value} }`;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Boolean' });
    Object.defineProperty(Value, 'true', { value: new this(true) });
    Object.defineProperty(Value, 'false', { value: new this(false) });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is BooleanValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-string-type */
export class JSStringValue extends PrimitiveValue {
  declare readonly type: 'String'; // defined on prototype by static block

  readonly value: string;

  private constructor(value: string) {
    super();
    this.value = value;
  }

  stringValue() {
    return this.value;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'String' });
    createStringValue = (value) => new this(value);
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is JSStringValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-symbol-type */
export class SymbolValue extends PrimitiveValue {
  declare readonly type: 'Symbol'; // defined on prototype by static block

  readonly Description: string | undefined;

  constructor(Description: string | undefined) {
    super();
    this.Description = Description;
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Symbol' });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is SymbolValue;
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-symbol-type */
export const wellKnownSymbols = {
  asyncDispose: new SymbolValue('Symbol.asyncDispose'),
  asyncIterator: new SymbolValue('Symbol.asyncIterator'),
  dispose: new SymbolValue('Symbol.dispose'),
  hasInstance: new SymbolValue('Symbol.hasInstance'),
  isConcatSpreadable: new SymbolValue('Symbol.isConcatSpreadable'),
  iterator: new SymbolValue('Symbol.iterator'),
  match: new SymbolValue('Symbol.match'),
  matchAll: new SymbolValue('Symbol.matchAll'),
  replace: new SymbolValue('Symbol.replace'),
  search: new SymbolValue('Symbol.search'),
  species: new SymbolValue('Symbol.species'),
  split: new SymbolValue('Symbol.split'),
  toPrimitive: new SymbolValue('Symbol.toPrimitive'),
  toStringTag: new SymbolValue('Symbol.toStringTag'),
  unscopables: new SymbolValue('Symbol.unscopables'),
} as const;
Object.setPrototypeOf(wellKnownSymbols, null);
Object.freeze(wellKnownSymbols);

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-number-type */
export class NumberValue extends PrimitiveValue {
  declare readonly type: 'Number'; // defined on prototype by static block

  readonly value: number;

  private constructor(value: number) {
    super();
    this.value = value;
  }

  numberValue() {
    return this.value;
  }

  isNaN() {
    return Number.isNaN(this.value);
  }

  isInfinity() {
    return !Number.isFinite(this.value) && !this.isNaN();
  }

  isFinite() {
    return Number.isFinite(this.value);
  }

  isIntegralNumber() {
    return Number.isInteger(this.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-unaryMinus */
  static unaryMinus(x: NumberValue) {
    if (x.isNaN()) {
      return F(NaN);
    }
    return F(-x.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseNOT */
  static bitwiseNOT(x: NumberValue) {
    // 1. Let oldValue be ! ToInt32(x).
    const oldValue = X(ToInt32(x));
    // 2. Return the result of applying bitwise complement to oldValue. The result is a signed 32-bit integer.
    return F(~R(oldValue));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-exponentiate */
  static exponentiate(base: NumberValue, exponent: NumberValue) {
    return F(base.value ** exponent.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-multiply */
  static multiply(x: NumberValue, y: NumberValue) {
    return F(x.value * y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-divide */
  static divide(x: NumberValue, y: NumberValue) {
    return F(x.value / y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-remainder */
  static remainder(n: NumberValue, d: NumberValue) {
    return F(n.value % d.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-add */
  static add(x: NumberValue, y: NumberValue) {
    return F(x.value + y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-subtract */
  static subtract(x: NumberValue, y: NumberValue) {
    return F(x.value - y.value);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-leftShift */
  static leftShift(x: NumberValue, y: NumberValue) {
    // 1. Let lnum be ! ToInt32(x).
    const lnum = X(ToInt32(x));
    // 2. Let rnum be ! ToUint32(y).
    const rnum = X(ToUint32(y));
    // 3. Let shiftCount be the result of masking out all but the least significant 5 bits of rnum, that is, compute rnum & 0x1F.
    const shiftCount = R(rnum) & 0x1F; // eslint-disable-line no-bitwise
    // 4. Return the result of left shifting lnum by shiftCount bits. The result is a signed 32-bit integer.
    return F(R(lnum) << shiftCount); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-signedRightShift */
  static signedRightShift(x: NumberValue, y: NumberValue) {
    // 1. Let lnum be ! ToInt32(x).
    const lnum = X(ToInt32(x));
    // 2. Let rnum be ! ToUint32(y).
    const rnum = X(ToUint32(y));
    // 3. Let shiftCount be the result of masking out all but the least significant 5 bits of rnum, that is, compute rnum & 0x1F.
    const shiftCount = R(rnum) & 0x1F; // eslint-disable-line no-bitwise
    // 4. Return the result of performing a sign-extending right shift of lnum by shiftCount bits.
    //    The most significant bit is propagated. The result is a signed 32-bit integer.
    return F(R(lnum) >> shiftCount); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-unsignedRightShift */
  static unsignedRightShift(x: NumberValue, y: NumberValue) {
    // 1. Let lnum be ! ToInt32(x).
    const lnum = X(ToInt32(x));
    // 2. Let rnum be ! ToUint32(y).
    const rnum = X(ToUint32(y));
    // 3. Let shiftCount be the result of masking out all but the least significant 5 bits of rnum, that is, compute rnum & 0x1F.
    const shiftCount = R(rnum) & 0x1F; // eslint-disable-line no-bitwise
    // 4. Return the result of performing a zero-filling right shift of lnum by shiftCount bits.
    //    Vacated bits are filled with zero. The result is an unsigned 32-bit integer.
    return F(R(lnum) >>> shiftCount); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-lessThan */
  static lessThan(x: NumberValue, y: NumberValue): boolean | undefined {
    if (x.isNaN()) {
      return undefined;
    }
    if (y.isNaN()) {
      return undefined;
    }
    // If nx and ny are the same Number value, return false.
    // If nx is +0 and ny is -0, return false.
    // If nx is -0 and ny is +0, return false.
    if (R(x) === R(y)) {
      return false;
    }
    if (R(x) === +Infinity) {
      return false;
    }
    if (R(y) === +Infinity) {
      return true;
    }
    if (R(y) === -Infinity) {
      return false;
    }
    if (R(x) === -Infinity) {
      return true;
    }
    return R(x) < R(y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-equal */
  static equal(x: NumberValue, y: NumberValue): boolean {
    if (x.isNaN()) {
      return false;
    }
    if (y.isNaN()) {
      return false;
    }
    const xVal = R(x);
    const yVal = R(y);
    if (xVal === yVal) {
      return true;
    }
    if (Object.is(xVal, 0) && Object.is(yVal, -0)) {
      return true;
    }
    if (Object.is(xVal, -0) && Object.is(yVal, 0)) {
      return true;
    }
    return false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-sameValue */
  static sameValue(x: NumberValue, y: NumberValue): boolean {
    if (x.isNaN() && y.isNaN()) {
      return true;
    }
    const xVal = x.value;
    const yVal = y.value;
    if (Object.is(xVal, 0) && Object.is(yVal, -0)) {
      return false;
    }
    if (Object.is(xVal, -0) && Object.is(yVal, 0)) {
      return false;
    }
    if (xVal === yVal) {
      return true;
    }
    return false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-sameValueZero */
  static sameValueZero(x: NumberValue, y: NumberValue): boolean {
    if (x.isNaN() && y.isNaN()) return true;
    if (Object.is(x.value, 0) && Object.is(y.value, -0)) return true;
    if (Object.is(x.value, -0) && Object.is(y.value, 0)) return true;
    if (x.value === y.value) return true;
    return false;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseAND */
  static bitwiseAND(x: NumberValue, y: NumberValue) {
    // 1. Return NumberBitwiseOp(&, x, y).
    return NumberBitwiseOp('&', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseXOR */
  static bitwiseXOR(x: NumberValue, y: NumberValue) {
    // 1. Return NumberBitwiseOp(^, x, y).
    return NumberBitwiseOp('^', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-bitwiseOR */
  static bitwiseOR(x: NumberValue, y: NumberValue) {
    // 1. Return NumberBitwiseOp(|, x, y).
    return NumberBitwiseOp('|', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-number-tostring */
  static override toString(x: NumberValue, radix: Integer): string {
    if (x.isNaN()) return 'NaN';
    if (Object.is(x.value, -0) || Object.is(x.value, 0)) return '0';
    if (x.value < 0) return `-${NumberValue.toString(F(-x.value), radix)}`;
    if (x.isInfinity()) return 'Infinity';
    return `${x.value.toString(Number(radix))}`;
  }

  static readonly unit = new NumberValue(1);

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Number' });
    createNumberValue = (value) => new NumberValue(value);
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is NumberValue;
}

/** https://tc39.es/ecma262/#sec-numberbitwiseop */
function NumberBitwiseOp(op: '&' | '|' | '^', x: NumberValue, y: NumberValue) {
  // 1. Let lnum be ! ToInt32(x).
  const lnum = X(ToInt32(x));
  // 2. Let rnum be ! ToUint32(y).
  const rnum = X(ToUint32(y));
  // 3. Return the result of applying the bitwise operator op to lnum and rnum. The result is a signed 32-bit integer.
  switch (op) {
    case '&':
      return F(R(lnum) & R(rnum));
    case '|':
      return F(R(lnum) | R(rnum));
    case '^':
      return F(R(lnum) ^ R(rnum));
    default:
      throw OutOfRange.exhaustive(op);
  }
}

/** https://tc39.es/ecma262/#sec-ecmascript-language-types-bigint-type */
export class BigIntValue extends PrimitiveValue {
  declare readonly type: 'BigInt'; // defined on prototype by static block

  readonly value: bigint;

  private constructor(value: bigint) {
    super();
    this.value = value;
  }

  bigintValue() {
    return this.value;
  }

  isNaN() {
    return false;
  }

  isFinite() {
    return true;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-unaryMinus */
  static unaryMinus(x: BigIntValue) {
    if (R(x) === 0n) {
      return Z(0n);
    }
    return Z(-R(x));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseNOT */
  static bitwiseNOT(x: BigIntValue) {
    return Z(-R(x) - 1n);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-exponentiate */
  static exponentiate(base: BigIntValue, exponent: BigIntValue) {
    // 1. If exponent < 0n, throw a RangeError exception.
    if (R(exponent) < 0n) {
      return Throw.RangeError('Exponent of bigint must be positive');
    }
    // 2. If base is 0n and exponent is 0n, return 1n.
    if (R(base) === 0n && R(exponent) === 0n) {
      return Z(1n);
    }
    // 3. Return the BigInt value that represents the mathematical value of base raised to the power exponent.
    return Z(R(base) ** R(exponent));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-multiply */
  static multiply(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) * R(y));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-divide */
  static divide(x: BigIntValue, y: BigIntValue) {
    // 1. If y is 0n, throw a RangeError exception.
    if (R(y) === 0n) {
      return Throw.RangeError('Cannot divide by zero');
    }
    // 2. Let quotient be the mathematical value of x divided by y.
    const quotient = R(x) / R(y);
    // 3. Return the BigInt value that represents quotient rounded towards 0 to the next integral value.
    return Z(quotient);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-remainder */
  static remainder(n: BigIntValue, d: BigIntValue) {
    // 1. If d is 0n, throw a RangeError exception.
    if (R(d) === 0n) {
      return Throw.RangeError('Cannot divide by zero');
    }
    // 2. If n is 0n, return 0n.
    if (R(n) === 0n) {
      return Z(0n);
    }
    // 3. Let r be the BigInt defined by the mathematical relation r = n - (d × q)
    //   where q is a BigInt that is negative only if n/d is negative and positive
    //   only if n/d is positive, and whose magnitude is as large as possible without
    //   exceeding the magnitude of the true mathematical quotient of n and d.
    const r = Z(R(n) % R(d));
    // 4. Return r.
    return r;
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-add */
  static add(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) + R(y));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-subtract */
  static subtract(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) - R(y));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-leftShift */
  static leftShift(x: BigIntValue, y: BigIntValue) {
    return Z(R(x) << R(y)); // eslint-disable-line no-bitwise
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-signedRightShift */
  static signedRightShift(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigInt::leftShift(x, -y).
    return BigIntValue.leftShift(x, Z(-R(y)));
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-unsignedRightShift */
  static unsignedRightShift(_x: BigIntValue, _y: BigIntValue) {
    return Throw.TypeError('BigInt has no unsigned right shift, use >> instead');
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-lessThan */
  static lessThan(x: BigIntValue, y: BigIntValue): boolean {
    return R(x) < R(y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-equal */
  static equal(x: BigIntValue, y: BigIntValue): boolean {
    // Return true if x and y have the same mathematical integer value and false otherwise.
    return R(x) === R(y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseAND */
  static bitwiseAND(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigIntBitwiseOp(&, x, y).
    return BigIntBitwiseOp('&', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseXOR */
  static bitwiseXOR(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigIntBitwiseOp(^, x, y).
    return BigIntBitwiseOp('^', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-bitwiseOR */
  static bitwiseOR(x: BigIntValue, y: BigIntValue) {
    // 1. Return BigIntBitwiseOp(|, x, y);
    return BigIntBitwiseOp('|', x, y);
  }

  /** https://tc39.es/ecma262/#sec-numeric-types-bigint-tostring */
  static override toString(x: BigIntValue, radix: Integer): string {
    // 1. If x is less than zero, return the string-concatenation of the String "-" and ! BigInt::toString(-x).
    if (R(x) < 0n) {
      const str = X(BigIntValue.toString(Z(-R(x)), radix));
      return `-${str}`;
    }
    // 2. Return the String value consisting of the code units of the digits of the decimal representation of x.
    return `${R(x).toString(Number(radix))}`;
  }

  static readonly unit = new BigIntValue(1n);

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'BigInt' });
    createBigIntValue = (value) => new BigIntValue(value);
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is BigIntValue;
}

/** https://tc39.es/ecma262/#sec-bigintbitwiseop */
function BigIntBitwiseOp(op: '&' | '|' | '^', x: BigIntValue, y: BigIntValue) {
  switch (op) {
    case '&':
      return Z(R(x) & R(y));
    case '|':
      return Z(R(x) | R(y));
    case '^':
      return Z(R(x) ^ R(y));
    default:
      throw OutOfRange.exhaustive(op);
  }
}

export interface ObjectInternalMethods<Self> {
  GetPrototypeOf(this: Self): ValueEvaluator<ObjectValue | NullValue>;
  SetPrototypeOf(this: Self, V: ObjectValue | NullValue): PlainEvaluator<boolean>;
  IsExtensible(this: Self): PlainEvaluator<boolean>;
  PreventExtensions(this: Self): PlainEvaluator<boolean>;
  GetOwnProperty(this: Self, P: PropertyKeyValue | string): PlainEvaluator<FullyPopulatedDescriptor | undefined>;
  DefineOwnProperty(this: Self, P: PropertyKeyValue | string, Desc: Descriptor): PlainEvaluator<boolean>;
  HasProperty(this: Self, P: PropertyKeyValue | string): PlainEvaluator<boolean>;
  Get(this: Self, P: PropertyKeyValue | string, Receiver: Value): ValueEvaluator;
  Set(this: Self, P: PropertyKeyValue | string, V: Value, Receiver: Value): PlainEvaluator<boolean>;
  Delete(this: Self, P: PropertyKeyValue | string): PlainEvaluator<boolean>;
  OwnPropertyKeys(this: Self): PlainEvaluator<PropertyKeyValue[]>;
  Call?(this: Self, thisArg: Value, args: Arguments): ValueEvaluator;
  Construct?(this: Self, args: Arguments, newTarget: FunctionObject | UndefinedValue): ValueEvaluator<ObjectValue>;
}

export type ObjectSlotReturn = {
  [key in keyof ObjectInternalMethods<ObjectValue>]: ReturnType<NonNullable<ObjectInternalMethods<ObjectValue>[key]>>
};
/** https://tc39.es/ecma262/#sec-object-type */
export class ObjectValue extends Value implements ObjectInternalMethods<ObjectValue> {
  declare readonly type: 'Object'; // defined on prototype by static block

  readonly properties: PropertyKeyMap<FullyPopulatedDescriptor>;

  readonly internalSlotsList: readonly string[];

  readonly PrivateElements: PrivateElementRecord[];

  // https://tc39.es/proposal-pattern-matching/#sec-object-internal-methods-and-internal-slots
  readonly ConstructedBy: (ECMAScriptFunctionObject | DefaultConstructorBuiltinFunction)[];

  constructor(internalSlotsList: readonly string[]) {
    super();

    this.PrivateElements = [];
    this.ConstructedBy = [];
    this.properties = new PropertyKeyMap();
    this.internalSlotsList = internalSlotsList;
    surroundingAgent.debugger_markObjectCreated(this);
  }

  // UNSAFE casts below. Methods below are expected to be rewritten when the object is not an OrdinaryObject. (an example is ArgumentExoticObject)
  // If those methods aren't rewritten, it is an error.
  // eslint-disable-next-line require-yield
  * GetPrototypeOf(): ObjectSlotReturn['GetPrototypeOf'] {
    return OrdinaryGetPrototypeOf(this as unknown as OrdinaryObject);
  }

  // eslint-disable-next-line require-yield
  * SetPrototypeOf(V: ObjectValue | NullValue): ObjectSlotReturn['SetPrototypeOf'] {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return OrdinarySetPrototypeOf(this as unknown as OrdinaryObject, V);
  }

  // eslint-disable-next-line require-yield
  * IsExtensible(): ObjectSlotReturn['IsExtensible'] {
    return OrdinaryIsExtensible(this as unknown as OrdinaryObject);
  }

  // eslint-disable-next-line require-yield
  * PreventExtensions(): ObjectSlotReturn['PreventExtensions'] {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return OrdinaryPreventExtensions(this as unknown as OrdinaryObject);
  }

  // eslint-disable-next-line require-yield
  * GetOwnProperty(P: PropertyKeyValue | string): ObjectSlotReturn['GetOwnProperty'] {
    if (P instanceof JSStringValue) P = P.stringValue();
    return OrdinaryGetOwnProperty(this as unknown as OrdinaryObject, P);
  }

  * DefineOwnProperty(P: PropertyKeyValue | string, Desc: Descriptor): ObjectSlotReturn['DefineOwnProperty'] {
    if (P instanceof JSStringValue) P = P.stringValue();
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return yield* OrdinaryDefineOwnProperty(this as unknown as OrdinaryObject, P, Desc);
  }

  * HasProperty(P: PropertyKeyValue | string): ObjectSlotReturn['HasProperty'] {
    if (P instanceof JSStringValue) P = P.stringValue();
    return yield* OrdinaryHasProperty(this as unknown as OrdinaryObject, P);
  }

  * Get(P: PropertyKeyValue | string, Receiver: Value): ObjectSlotReturn['Get'] {
    if (P instanceof JSStringValue) P = P.stringValue();
    return yield* OrdinaryGet(this as unknown as OrdinaryObject, P, Receiver);
  }

  * Set(P: PropertyKeyValue | string, V: Value, Receiver: Value): ObjectSlotReturn['Set'] {
    if (P instanceof JSStringValue) P = P.stringValue();
    // TODO:
    Q(surroundingAgent.debugger_tryTouchDuringPreview(Receiver as ObjectValue));
    return yield* OrdinarySet(this as unknown as OrdinaryObject, P, V, Receiver);
  }

  * Delete(P: PropertyKeyValue | string): ObjectSlotReturn['Delete'] {
    if (P instanceof JSStringValue) P = P.stringValue();
    Q(surroundingAgent.debugger_tryTouchDuringPreview(this));
    return yield* OrdinaryDelete(this as unknown as OrdinaryObject, P);
  }

  // eslint-disable-next-line require-yield
  * OwnPropertyKeys(): ObjectSlotReturn['OwnPropertyKeys'] {
    return OrdinaryOwnPropertyKeys(this as unknown as OrdinaryObject);
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.properties);
    this.internalSlotsList.forEach((s) => {
      // @ts-ignore
      m(this[s]);
      if (s === 'HostCapturedValues' && s in this && Array.isArray(this[s])) {
        this[s].forEach(m);
      }
    });

    this.PrivateElements.forEach((pr) => {
      m(pr);
    });
  }

  static {
    Object.defineProperty(this.prototype, 'type', { value: 'Object' });
  }

  declare static [Symbol.hasInstance]: (value: unknown) => value is ObjectValue;
}

/** https://tc39.es/ecma262/#sec-private-names */
export class PrivateName {
  // NOTE: The following declaration distinguishes `PrivateName` from `SymbolValue` so that type guards can properly
  //       remove it from unions with `SymbolValue` due to structural overlap.
  declare private _: never;

  readonly Description: string;

  constructor(description: string) {
    this.Description = description;
  }
}

export class ReferenceRecord {
  readonly Base: 'unresolvable' | Value | EnvironmentRecord;

  ReferencedName: Value | PrivateName;

  readonly Strict: boolean;

  readonly ThisValue: Value | undefined;

  constructor({
    Base,
    ReferencedName,
    Strict,
    ThisValue,
  }: Pick<ReferenceRecord, 'Base' | 'ReferencedName' | 'Strict' | 'ThisValue'>) {
    this.Base = Base;
    this.ReferencedName = ReferencedName;
    this.Strict = Strict;
    this.ThisValue = ThisValue;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.Base);
    m(this.ReferencedName);
    m(this.ThisValue);
  }
}

export interface DescriptorWithEnumerableAndConfigurable {
  readonly Configurable: boolean;
  readonly Enumerable: boolean;
}

export type AccessorDescriptorInit = ({
  readonly Get: FunctionObject | UndefinedValue;
  readonly Set?: FunctionObject | UndefinedValue;
} | {
  readonly Get?: FunctionObject | UndefinedValue;
  readonly Set: FunctionObject | UndefinedValue;
}) & Partial<DescriptorWithEnumerableAndConfigurable>

export type DataDescriptorInit = ({
  readonly Value: Value;
  readonly Writable?: boolean;
} | {
  readonly Value?: Value;
  readonly Writable: boolean;
}) & Partial<DescriptorWithEnumerableAndConfigurable>

export interface GenericDescriptorInit {
  readonly Configurable?: boolean;
  readonly Enumerable?: boolean;
  readonly Value?: never;
  readonly Writable?: never;
  readonly Get?: never;
  readonly Set?: never;
}

// @ts-expect-error
export function Descriptor(init: Required<AccessorDescriptorInit>): FullyPopulatedAccessorDescriptor // @ts-expect-error
export function Descriptor(init: Required<DataDescriptorInit>): FullyPopulatedDataDescriptor // @ts-expect-error
export function Descriptor(init: AccessorDescriptorInit): AccessorDescriptor // @ts-expect-error
export function Descriptor(init: DataDescriptorInit): DataDescriptor // @ts-expect-error
export function Descriptor(init: Partial<AccessorDescriptorInit>): GenericDescriptor // @ts-expect-error
export function Descriptor(init: Partial<DataDescriptorInit>): GenericDescriptor // @ts-expect-error
export function Descriptor(init: Partial<GenericDescriptorInit>): GenericDescriptor // @ts-expect-error
export @callable() class Descriptor {
  readonly Value?: Value;

  readonly Get?: FunctionObject | UndefinedValue;

  readonly Set?: FunctionObject | UndefinedValue;

  readonly Writable?: boolean;

  readonly Enumerable?: boolean;

  readonly Configurable?: boolean;

  private constructor(O: AccessorDescriptorInit & DataDescriptorInit) {
    this.Value = O.Value;
    this.Get = O.Get;
    this.Set = O.Set;
    this.Writable = O.Writable;
    this.Enumerable = O.Enumerable;
    this.Configurable = O.Configurable;
  }

  static everyFieldIsAbsent(descriptor: Descriptor) {
    return descriptor.Value === undefined
      && descriptor.Get === undefined
      && descriptor.Set === undefined
      && descriptor.Writable === undefined
      && descriptor.Enumerable === undefined
      && descriptor.Configurable === undefined;
  }

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.Value);
    m(this.Get);
    m(this.Set);
  }
}

export class DataBlock extends Uint8Array {}

/** https://tc39.es/ecma262/#sec-sametype */
export function SameType(x: Value, y: Value) {
  switch (true) {
    case x === Value.undefined && y === Value.undefined:
    case x === Value.null && y === Value.null:
    case x instanceof BooleanValue && y instanceof BooleanValue:
    case x instanceof NumberValue && y instanceof NumberValue:
    case x instanceof BigIntValue && y instanceof BigIntValue:
    case x instanceof SymbolValue && y instanceof SymbolValue:
    case x instanceof JSStringValue && y instanceof JSStringValue:
    case x instanceof ObjectValue && y instanceof ObjectValue:
      return true;
    default:
      return false;
  }
}

export type SafeAccessMethods = 'map' | 'values' | 'entries' | 'filter' | 'forEach' | 'find';
// function* myFunction([callback]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator
//                       ^^^^^^^^
// if user calls myFunction with no arguments, callback would be undefined, not Value.undefined
// the correct way is to type it as:
// function* myFunction([callback = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator
//
// this type is to prevent such mistakes
export type Arguments =
  Omit<readonly (Value | undefined)[], SafeAccessMethods> &
  Pick<readonly Value[], SafeAccessMethods>;
export interface FunctionCallContext {
  readonly thisValue: Value;
  readonly NewTarget: FunctionObject | UndefinedValue;
}
export interface NativeSteps {
  (this: BuiltinFunctionObject, args: Arguments, context: FunctionCallContext): PlainEvaluator<Value | void> | PlainCompletion<Value | void>;
  section?: string;
  isConstructor?: boolean;
}
export interface CanBeNativeSteps {
  (...args: (Value | undefined)[]): PlainEvaluator<Value | void> | PlainCompletion<Value | void>;
}
