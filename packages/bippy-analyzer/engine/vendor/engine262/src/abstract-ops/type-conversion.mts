import {
  UndefinedValue, JSStringValue, SymbolValue,
  ObjectValue,
  Value,
  NumberValue,
  BigIntValue,
  wellKnownSymbols,
  NullValue,
  BooleanValue,
  PrimitiveValue,
  type PropertyKeyValue,
} from '../value.mts';
import {
  Q, X,
  type ValueCompletion,
} from '../completion.mts';
import { OutOfRange, type Mutable } from '../utils/language.mts';
import { MV_StringNumericLiteral } from '../runtime-semantics/all.mts';
import type { BooleanObject } from '../intrinsics/Boolean.mts';
import type { NumberObject } from '../intrinsics/Number.mts';
import type { SymbolObject } from '../intrinsics/Symbol.mts';
import type { BigIntObject } from '../intrinsics/BigInt.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  Assert,
  Call,
  Get,
  GetMethod,
  IsCallable,
  OrdinaryObjectCreate,
  StringCreate,
  Z,
  F, R, type Integer,
} from './all.mts';
import { clamp, modulo, truncate } from './math.mts';
import {
  surroundingAgent,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-toprimitive */
export function* ToPrimitive(input: Value, preferredType?: 'string' | 'number'): ValueEvaluator<PrimitiveValue> {
  // 1. Assert: input is an ECMAScript language value.
  Assert(input instanceof Value);
  // 2. If Type(input) is Object, then
  if (input instanceof ObjectValue) {
    // a. Let exoticToPrim be ? GetMethod(input, @@toPrimitive).
    const exoticToPrim = Q(yield* GetMethod(input, wellKnownSymbols.toPrimitive));
    // b. If exoticToPrim is not undefined, then
    if (exoticToPrim !== Value.undefined) {
      let hint;
      // i. If preferredType is not present, let hint be "default".
      if (preferredType === undefined) {
        hint = Value('default');
      } else if (preferredType === 'string') { // ii. Else if preferredType is string, let hint be "string".
        hint = Value('string');
      } else { // iii. Else,
        // 1. Assert: preferredType is number.
        Assert(preferredType === 'number');
        // 2. Let hint be "number".
        hint = Value('number');
      }
      // iv. Let result be ? Call(exoticToPrim, input, « hint »).
      const result = Q(yield* Call(exoticToPrim, input, [hint]));
      // v. If Type(result) is not Object, return result.
      if (!(result instanceof ObjectValue)) {
        return result;
      }
      // vi. Throw a TypeError exception.
      return Throw.TypeError('Cannot convert object to primitive value');
    }
    // c. If preferredType is not present, let preferredType be number.
    if (preferredType === undefined) {
      preferredType = 'number';
    }
    // d. Return ? OrdinaryToPrimitive(input, preferredType).
    return Q(yield* OrdinaryToPrimitive(input, preferredType));
  }
  // 3. Return input.
  return input;
}

/** https://tc39.es/ecma262/#sec-ordinarytoprimitive */
export function* OrdinaryToPrimitive(O: ObjectValue, hint: 'string' | 'number'): ValueEvaluator<PrimitiveValue> {
  // 1. Assert: Type(O) is Object.
  Assert(O instanceof ObjectValue);
  // 2. Assert: hint is either string or number.
  Assert(hint === 'string' || hint === 'number');
  let methodNames;
  // 3. If hint is string, then
  if (hint === 'string') {
    // a. Let methodNames be « "toString", "valueOf" ».
    methodNames = [Value('toString'), Value('valueOf')];
  } else { // 4. Else,
    // a. Let methodNames be « "valueOf", "toString" ».
    methodNames = [Value('valueOf'), Value('toString')];
  }
  // 5. For each element name of methodNames, do
  for (const name of methodNames) {
    // a. Let method be ? Get(O, name).
    const method = Q(yield* Get(O, name));
    // b. If IsCallable(method) is true, then
    if (IsCallable(method)) {
      // i. Let result be ? Call(method, O).
      const result = Q(yield* Call(method, O));
      // ii. If Type(result) is not Object, return result.
      if (!(result instanceof ObjectValue)) {
        return result;
      }
    }
  }
  // 6. Throw a TypeError exception.
  return Throw.TypeError('Cannot convert object to primitive value');
}

/** https://tc39.es/ecma262/#sec-toboolean */
export function ToBoolean(argument: Value): boolean {
  if (argument instanceof UndefinedValue) {
    // Return false.
    return false;
  } else if (argument instanceof NullValue) {
    // Return false.
    return false;
  } else if (argument instanceof BooleanValue) {
    // Return argument.
    return argument === Value.true;
  } else if (argument instanceof NumberValue) {
    // If argument is +0𝔽, -0𝔽, or NaN, return false; otherwise return true.
    if (R(argument) === 0 || argument.isNaN()) {
      return false;
    }
  } else if (argument instanceof JSStringValue) {
    // If argument is the empty String, return false; otherwise return true.
    if (argument.stringValue().length === 0) {
      return false;
    }
  } else if (argument instanceof BigIntValue) {
    // If argument is 0ℤ, return false; otherwise return true.
    if (R(argument) === 0n) {
      return false;
    }
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-tonumeric */
export function* ToNumeric(value: Value): ValueEvaluator<NumberValue | BigIntValue> {
  // 1. Let primValue be ? ToPrimitive(value, number).
  const primValue = Q(yield* ToPrimitive(value, 'number'));
  // 2. If Type(primValue) is BigInt, return primValue.
  if (primValue instanceof BigIntValue) {
    return primValue;
  }
  // 3. Return ? ToNumber(primValue).
  return Q(yield* ToNumber(primValue));
}

/** https://tc39.es/ecma262/#sec-tonumber */
export function* ToNumber(argument: Value): ValueEvaluator<NumberValue> {
  if (argument instanceof UndefinedValue) {
    // Return NaN.
    return F(NaN);
  } else if (argument instanceof NullValue) {
    // Return +0𝔽.
    return F(+0);
  } else if (argument instanceof BooleanValue) {
    // If argument is true, return 1𝔽.
    if (argument === Value.true) {
      return F(1);
    }
    // If argument is false, return +0𝔽.
    return F(+0);
  } else if (argument instanceof NumberValue) {
    // Return argument (no conversion).
    return argument;
  } else if (argument instanceof JSStringValue) {
    return MV_StringNumericLiteral(argument.stringValue());
  } else if (argument instanceof BigIntValue) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot mix BigInt and other types, use explicit conversions');
  } else if (argument instanceof SymbolValue) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert a symbol value $1 to a number', argument);
  } else if (argument instanceof ObjectValue) {
    // 1. Let primValue be ? ToPrimitive(argument, number).
    const primValue = Q(yield* ToPrimitive(argument, 'number'));
    // 2. Return ? ToNumber(primValue).
    return Q(yield* ToNumber(primValue));
  }
  throw OutOfRange.exhaustive(argument);
}

/** https://tc39.es/ecma262/#sec-stringtonumber */
export function StringToNumber(str: string) {
  // Note: this function should parse strings like 1_000 or 0x111, but we currently not using them.
  return parseFloat(str);
}

/** https://tc39.es/ecma262/#sec-tointegerorinfinity */
export function* ToIntegerOrInfinity(argument: Value | number): PlainEvaluator<number> {
  const number = typeof argument === 'number' ? Value(argument) : Q(yield* ToNumber(argument));
  if (number.isNaN() || Object.is(number.value, -0) || number.value === 0) return +0;
  // 3. If number is +∞𝔽, return +∞.
  // 4. If number is -∞𝔽, return -∞.
  if (!number.isFinite()) return number.value;
  return truncate(R(number));
}

/** https://tc39.es/ecma262/#sec-snaptointeger */
export function* SnapToInteger(
  arg: Value,
  nonIntHandling: 'reject' | 'strict' | 'truncate',
  minimum?: Integer,
  maximum?: Integer,
): PlainEvaluator<Integer> {
  const number = Q(yield* ToNumber(arg));
  if (number.isNaN() || number.isInfinity()) {
    return Throw.RangeError('$1 is not a finite number', number);
  }
  let mv = R(number);
  if (nonIntHandling === 'truncate') {
    mv = truncate(mv);
  }
  if (!Number.isInteger(mv)) {
    return Throw.RangeError('$1 is not an integer', number);
  }
  if (minimum !== undefined && mv < minimum) {
    return Throw.RangeError('$1 is too small', number);
  }
  if (maximum !== undefined && mv > maximum) {
    return Throw.RangeError('$1 is too large', number);
  }
  return BigInt(mv) as Integer;
}

/** https://tc39.es/ecma262/#sec-toabsoluteindex */
export function* ToAbsoluteIndex(value: Value | number, length: number): PlainEvaluator<number> {
  let int = Q(yield* ToIntegerOrInfinity(value));
  if (Number.isFinite(int) && int < 0) {
    int = length + int;
  }
  return int;
}

/** https://tc39.es/ecma262/#sec-toclampedindex */
export function* ToClampedIndex(value: Value | number, length: number): PlainEvaluator<number> {
  const index = Q(yield* ToAbsoluteIndex(value, length));
  return clamp(0, index, length);
}

/** https://tc39.es/ecma262/#sec-tofixedsizeinteger */
export function ToFixedSizeInteger(int: number, signed: 'signed' | 'unsigned', bitWidth: number): number;
export function ToFixedSizeInteger(int: bigint, signed: 'signed' | 'unsigned', bitWidth: bigint): bigint;
export function ToFixedSizeInteger(
  int: number | bigint,
  signed: 'signed' | 'unsigned',
  bitWidth: number | bigint,
): number | bigint {
  const one = (typeof int === 'number' ? 1 : 1n) as bigint;
  const two = (typeof int === 'number' ? 2 : 2n) as bigint;
  if (int === Infinity || int === -Infinity) {
    return 0;
  }
  const modulus = two ** (bitWidth as bigint);
  let fixedInt = modulo(int as bigint, modulus);
  if (signed === 'signed') {
    const signBit = two ** (bitWidth as bigint - one);
    if (fixedInt >= signBit) {
      fixedInt -= modulus;
    }
  }
  return fixedInt;
}

/** https://tc39.es/ecma262/#sec-toint32 */
export function* ToInt32(argument: Value): ValueEvaluator<NumberValue> {
  const int = Q(yield* ToIntegerOrInfinity(argument));
  return F(ToFixedSizeInteger(int, 'signed', 32));
}

/** https://tc39.es/ecma262/#sec-touint32 */
export function* ToUint32(argument: number | Value): ValueEvaluator<NumberValue> {
  const int = Q(yield* ToIntegerOrInfinity(argument));
  return F(ToFixedSizeInteger(int, 'unsigned', 32));
}

/** https://tc39.es/ecma262/#sec-toint16 */
export function* ToInt16(argument: Value): ValueEvaluator<NumberValue> {
  const int = Q(yield* ToIntegerOrInfinity(argument));
  return F(ToFixedSizeInteger(int, 'signed', 16));
}

/** https://tc39.es/ecma262/#sec-touint16 */
export function* ToUint16(argument: Value): ValueEvaluator<NumberValue> {
  const int = Q(yield* ToIntegerOrInfinity(argument));
  return F(ToFixedSizeInteger(int, 'unsigned', 16));
}

/** https://tc39.es/ecma262/#sec-toint8 */
export function* ToInt8(argument: Value): ValueEvaluator<NumberValue> {
  const int = Q(yield* ToIntegerOrInfinity(argument));
  return F(ToFixedSizeInteger(int, 'signed', 8));
}

/** https://tc39.es/ecma262/#sec-touint8 */
export function* ToUint8(argument: Value): ValueEvaluator<NumberValue> {
  const int = Q(yield* ToIntegerOrInfinity(argument));
  return F(ToFixedSizeInteger(int, 'unsigned', 8));
}

/** https://tc39.es/ecma262/#sec-touint8clamp */
export function* ToUint8Clamp(argument: Value): ValueEvaluator<NumberValue> {
  // 1. Let number be ? ToNumber(argument).
  const number = R(Q(yield* ToNumber(argument)));
  // 2. If number is NaN, return +0𝔽.
  if (Number.isNaN(number)) {
    return F(+0);
  }
  // 3. If ℝ(number) ≤ 0, return +0𝔽.
  if (number <= 0) {
    return F(+0);
  }
  // 4. If ℝ(number) ≥ 255, return 255𝔽.
  if (number >= 255) {
    return F(255);
  }
  // 5. Let f be floor(ℝ(number)).
  const f = Math.floor(number);
  // 6. If f + 0.5 < ℝ(number), return 𝔽(f + 1).
  if (f + 0.5 < number) {
    return F(f + 1);
  }
  // 7. If ℝ(number) < f + 0.5, return 𝔽(f).
  if (number < f + 0.5) {
    return F(f);
  }
  // 8. If f is odd, return 𝔽(f + 1).
  if (f % 2 === 1) {
    return F(f + 1);
  }
  // 9. Return 𝔽(f).
  return F(f);
}

/** https://tc39.es/ecma262/#sec-tobigint */
export function* ToBigInt(argument: Value): ValueEvaluator<BigIntValue> {
  // 1. Let prim be ? ToPrimitive(argument, number).
  const prim = Q(yield* ToPrimitive(argument, 'number'));
  // 2. Return the value that prim corresponds to in Table 12 (#table-tobigint).
  if (prim instanceof UndefinedValue) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert $1 to a BigInt', prim);
  } else if (prim instanceof NullValue) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert $1 to a BigInt', prim);
  } else if (prim instanceof BooleanValue) {
    // Return 1ℤ if prim is true and 0ℤ if prim is false.
    if (prim === Value.true) {
      return Z(1n);
    }
    return Z(0n);
  } else if (prim instanceof BigIntValue) {
    // Return prim.
    return prim;
  } else if (prim instanceof NumberValue) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert $1 to a BigInt', prim);
  } else if (prim instanceof JSStringValue) {
    // 1. Let n be StringToBigInt(prim).
    const n = StringToBigInt(prim);
    // 2. If n is NaN, throw a SyntaxError exception.
    if (n === undefined) {
      return Throw.SyntaxError('Cannot convert $1 to a BigInt', prim);
    }
    // 3. Return n.
    return n;
  } else if (prim instanceof SymbolValue) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert a Symbol value to a $1', 'bigint');
  }
  throw OutOfRange.nonExhaustive(argument);
}

/** https://tc39.es/ecma262/#sec-stringtobigint */
export function StringToBigInt(argument: JSStringValue) {
  try {
    return Z(BigInt(argument.stringValue()));
  } catch {
    return undefined;
  }
}

/** https://tc39.es/ecma262/#sec-tobigint64 */
export function* ToBigInt64(argument: Value): ValueEvaluator<BigIntValue> {
  const int = R(Q(yield* ToBigInt(argument)));
  return Z(ToFixedSizeInteger(int, 'signed', 64n));
}

/** https://tc39.es/ecma262/#sec-tobiguint64 */
export function* ToBigUint64(argument: Value): PlainEvaluator<bigint> {
  const int = R(Q(yield* ToBigInt(argument)));
  return ToFixedSizeInteger(int, 'unsigned', 64n);
}

/** https://tc39.es/ecma262/#sec-tostring */
export function* ToString(argument: Value): PlainEvaluator<string> {
  if (argument instanceof UndefinedValue) {
    return 'undefined';
  } else if (argument instanceof NullValue) {
    return 'null';
  } else if (argument instanceof BooleanValue) {
    return argument === Value.true ? 'true' : 'false';
  } else if (argument instanceof NumberValue) {
    return X(NumberValue.toString(argument, 10n));
  } else if (argument instanceof JSStringValue) {
    return argument.stringValue();
  } else if (argument instanceof SymbolValue) {
    return Throw.TypeError('Cannot convert a Symbol value to a $1', 'string');
  } else if (argument instanceof BigIntValue) {
    return BigIntValue.toString(argument, 10n);
  } else if (argument instanceof ObjectValue) {
    const primValue = Q(yield* ToPrimitive(argument, 'string'));
    return Q(yield* ToString(primValue));
  }
  throw OutOfRange.exhaustive(argument);
}

/** https://tc39.es/ecma262/#sec-toobject */
export function ToObject(argument: Value): ValueCompletion<ObjectValue> {
  if (argument === Value.undefined) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert $1 to object', 'undefined');
  } else if (argument === Value.null) {
    // Throw a TypeError exception.
    return Throw.TypeError('Cannot convert $1 to object', 'null');
  } else if (argument instanceof BooleanValue) {
    // Return a new Boolean object whose [[BooleanData]] internal slot is set to argument.
    const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Boolean.prototype%'), ['BooleanData']) as Mutable<BooleanObject>;
    obj.BooleanData = argument.booleanValue();
    return obj;
  } else if (argument instanceof NumberValue) {
    // Return a new Number object whose [[NumberData]] internal slot is set to argument.
    const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Number.prototype%'), ['NumberData']) as Mutable<NumberObject>;
    obj.NumberData = argument;
    return obj;
  } else if (argument instanceof JSStringValue) {
    // Return a new String object whose [[StringData]] internal slot is set to argument.
    return StringCreate(argument.stringValue(), surroundingAgent.intrinsic('%String.prototype%'));
  } else if (argument instanceof SymbolValue) {
    // Return a new Symbol object whose [[SymbolData]] internal slot is set to argument.
    const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Symbol.prototype%'), ['SymbolData']) as Mutable<SymbolObject>;
    obj.SymbolData = argument;
    return obj;
  } else if (argument instanceof BigIntValue) {
    // Return a new BigInt object whose [[BigIntData]] internal slot is set to argument.
    const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%BigInt.prototype%'), ['BigIntData']) as Mutable<BigIntObject>;
    // eslint-disable-next-line @engine262/mathematical-value
    obj.BigIntData = argument.bigintValue();
    return obj;
  }
  Assert(argument instanceof ObjectValue);
  return argument;
}

/** https://tc39.es/ecma262/#sec-topropertykey */
export function* ToPropertyKey(argument: Value): ValueEvaluator<PropertyKeyValue> {
  // 1. Let key be ? ToPrimitive(argument, string).
  const key = Q(yield* ToPrimitive(argument, 'string'));
  // 2. If Type(key) is Symbol, then
  if (key instanceof SymbolValue) {
    // a. Return key.
    return key;
  }
  // 3. Return ! ToString(key).
  return Value(X(ToString(key)));
}

/** https://tc39.es/ecma262/#sec-tolength */
export function* ToLength(arg: Value): ValueEvaluator<NumberValue> {
  const length = Q(yield* ToIntegerOrInfinity(arg));
  const clampedLength = clamp(0, length, (2 ** 53) - 1);
  return F(clampedLength);
}

/** https://tc39.es/ecma262/#sec-canonicalnumericindexstring */
export function CanonicalNumericIndexString(arg: string): NumberValue | undefined {
  if (arg === '-0') return F(-0);
  const n = X(ToNumber(Value(arg)));
  if (X(ToString(n)) === arg) return n;
  return undefined;
}

/** https://tc39.es/ecma262/#sec-toindex */
export function* ToIndex(value: Value) {
  const integer = Q(yield* ToIntegerOrInfinity(value));
  if (Object.is(integer, -0) || integer < 0) {
    return Throw.RangeError('$1 cannot be used as an index', value);
  }
  if (integer > (2 ** 53 - 1)) {
    return Throw.RangeError('Index $1 is too big', value);
  }
  return integer;
}
