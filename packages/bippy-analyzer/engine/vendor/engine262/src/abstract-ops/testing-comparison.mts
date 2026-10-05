import {
  BigIntValue,
  BooleanValue,
  SymbolValue,
  JSStringValue,
  NumberValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
} from '../value.mts';
import { Q, X } from '../completion.mts';
import {
  Assert,
  Get,
  ToBoolean,
  ToNumber,
  ToNumeric,
  ToPrimitive,
  StringToBigInt,
  isProxyExoticObject,
  isArrayExoticObject, R,
  SameType,
  type FunctionObject,
  type PropertyKeyValue,
  Throw,
  type PlainEvaluator,
  ThrowCompletion,
} from '#self';

// This file covers abstract operations defined in
/** https://tc39.es/ecma262/#sec-testing-and-comparison-operations */

/** https://tc39.es/ecma262/#sec-requireobjectcoercible */
export function RequireObjectCoercible(argument: Value) {
  if (argument === Value.undefined) {
    return Throw.TypeError('Cannot convert $1 to object', 'undefined');
  }
  if (argument === Value.null) {
    return Throw.TypeError('Cannot convert $1 to object', 'null');
  }
  return undefined;
}

/** https://tc39.es/ecma262/#sec-isarray */
export function IsArray(argument: Value): boolean | ThrowCompletion {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  if (isArrayExoticObject(argument)) {
    return true;
  }
  if (isProxyExoticObject(argument)) {
    if (argument.ProxyHandler === Value.null) {
      return Throw.TypeError("Cannot perform '$1' on a proxy that has been revoked", 'IsArray');
    }
    const target = argument.ProxyTarget;
    return IsArray(target);
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-iscallable */
export function IsCallable(argument: Value): argument is FunctionObject {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  if ('Call' in argument) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isconstructor */
export function IsConstructor(argument: Value): argument is FunctionObject {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  if ('Construct' in argument) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isextensible-o */
export function* IsExtensible(O: ObjectValue) {
  Assert(O instanceof ObjectValue);
  return yield* O.IsExtensible();
}

/** https://tc39.es/ecma262/#sec-isinteger */
export function IsIntegralNumber(argument: Value): boolean {
  if (!(argument instanceof NumberValue)) {
    return false;
  }
  if (argument.isNaN() || argument.isInfinity()) {
    return false;
  }
  if (Math.floor(Math.abs(R(argument))) !== Math.abs(R(argument))) {
    return false;
  }
  return true;
}

/** https://tc39.es/ecma262/#sec-ispropertykey */
export function IsPropertyKey(argument: unknown): argument is PropertyKeyValue {
  if (argument instanceof JSStringValue) {
    return true;
  }
  if (argument instanceof SymbolValue) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isregexp */
export function* IsRegExp(argument: Value): PlainEvaluator<boolean> {
  if (!(argument instanceof ObjectValue)) {
    return false;
  }
  const matcher = Q(yield* Get(argument, wellKnownSymbols.match));
  if (matcher !== Value.undefined) {
    return ToBoolean(matcher);
  }
  if ('RegExpMatcher' in argument) {
    return true;
  }
  return false;
}

/** https://tc39.es/ecma262/#sec-isstringprefix */
export function IsStringPrefix(p: string, q: string) {
  return q.startsWith(p);
}

/** https://tc39.es/ecma262/#sec-samevalue */
export function SameValue(x: Value, y: Value): boolean {
  // If SameType(x, y) is false, return false.
  if (!SameType(x, y)) {
    return false;
  }
  // If x is a Number, then
  if (x instanceof NumberValue) {
    // a. Return Number::sameValue(x, y).
    return NumberValue.sameValue(x, y as NumberValue);
  }
  // 3. Return SameValueNonNumber(x, y).
  return SameValueNonNumber(x, y);
}

/** https://tc39.es/ecma262/#sec-samevaluezero */
export function SameValueZero(x: Value, y: Value): boolean {
  // 1. If SameType(x, y) is false, return false.
  if (!SameType(x, y)) {
    return false;
  }
  // 2. If x is a Number, then
  if (x instanceof NumberValue) {
    // a. Return Number::sameValueZero(x, y).
    return NumberValue.sameValueZero(x, y as NumberValue);
  }
  // 3. Return SameValueNonNumber(x, y).
  return SameValueNonNumber(x, y);
}

/** https://tc39.es/ecma262/#sec-samevaluenonnumber */
export function SameValueNonNumber(x: Value, y: Value): boolean {
  Assert(SameType(x, y));

  if (x === Value.undefined || x === Value.null) {
    return true;
  }

  if (x instanceof BigIntValue) {
    return BigIntValue.equal(x, y as BigIntValue);
  }

  if (x instanceof JSStringValue) {
    return x.stringValue() === (y as JSStringValue).stringValue();
  }

  if (x instanceof BooleanValue) {
    if (x === Value.true && y === Value.true) return true;
    if (x === Value.false && y === Value.false) return true;
    return false;
  }
  return x === y;
}

/** https://tc39.es/ecma262/#sec-islessthan */
export function* IsLessThan(x: Value, y: Value, LeftFirst = true): PlainEvaluator<boolean | undefined> {
  let px;
  let py;
  // 1. If the LeftFirst flag is true, then
  if (LeftFirst === true) {
    // a. Let px be ? ToPrimitive(x, number).
    px = Q(yield* ToPrimitive(x, 'number'));
    // b. Let py be ? ToPrimitive(y, number).
    py = Q(yield* ToPrimitive(y, 'number'));
  } else {
    // a. NOTE: The order of evaluation needs to be reversed to preserve left to right evaluation.
    // b. Let py be ? ToPrimitive(y, number).
    py = Q(yield* ToPrimitive(y, 'number'));
    // c. Let px be ? ToPrimitive(x, number).
    px = Q(yield* ToPrimitive(x, 'number'));
  }
  // 3. If Type(px) is String and Type(py) is String, then
  if (px instanceof JSStringValue && py instanceof JSStringValue) {
    // a. If IsStringPrefix(py, px) is true, return false.
    if (IsStringPrefix(py.stringValue(), px.stringValue())) {
      return false;
    }
    // b. If IsStringPrefix(px, py) is true, return true.
    if (IsStringPrefix(px.stringValue(), py.stringValue())) {
      return true;
    }
    // c. Let k be the smallest nonnegative integer such that the code unit at index k within px
    //    is different from the code unit at index k within py. (There must be such a k, for
    //    neither String is a prefix of the other.)
    let k = 0;
    while (true) {
      if (px.stringValue()[k] !== py.stringValue()[k]) {
        break;
      }
      k += 1;
    }
    // d. Let m be the integer that is the numeric value of the code unit at index k within px.
    const m = px.stringValue().charCodeAt(k);
    // e. Let n be the integer that is the numeric value of the code unit at index k within py.
    const n = py.stringValue().charCodeAt(k);
    // f. If m < n, return true. Otherwise, return false.
    if (m < n) {
      return true;
    } else {
      return false;
    }
  } else {
    // a. If Type(px) is BigInt and Type(py) is String, then
    if (px instanceof BigIntValue && py instanceof JSStringValue) {
      // i. Let ny be StringToBigInt(py).
      const ny = StringToBigInt(py);
      // ii. If ny is undefined, return undefined.
      if (ny === undefined) {
        return undefined;
      }
      // iii. Return BigInt::lessThan(px, ny).
      return BigIntValue.lessThan(px, ny);
    }
    // b. If Type(px) is String and Type(py) is BigInt, then
    if (px instanceof JSStringValue && py instanceof BigIntValue) {
      // i. Let ny be StringToBigInt(py).
      const nx = StringToBigInt(px);
      // ii. If ny is undefined, return undefined.
      if (nx === undefined) {
        return undefined;
      }
      // iii. Return BigInt::lessThan(px, ny).
      return BigIntValue.lessThan(nx, py);
    }
    // c. Let nx be ? ToNumeric(px). NOTE: Because px and py are primitive values evaluation order is not important.
    const nx = Q(yield* ToNumeric(px));
    // d. Let ny be ? ToNumeric(py).
    const ny = Q(yield* ToNumeric(py));
    // e. If Type(nx) is the same as Type(ny), return Type(nx)::lessThan(nx, ny).
    if (SameType(nx, ny)) {
      if (nx instanceof NumberValue) {
        return NumberValue.lessThan(nx, ny as NumberValue);
      } else {
        Assert(nx instanceof BigIntValue);
        return BigIntValue.lessThan(nx, ny as BigIntValue);
      }
    }
    // f. Assert: Type(nx) is BigInt and Type(ny) is Number, or Type(nx) is Number and Type(ny) is BigInt.
    Assert((nx instanceof BigIntValue && ny instanceof NumberValue) || (nx instanceof NumberValue && ny instanceof BigIntValue));
    // g. If nx or ny is NaN, return undefined.
    if ((nx.isNaN && nx.isNaN()) || (ny.isNaN && ny.isNaN())) {
      return undefined;
    }
    // h. If nx is -∞ or ny is +∞, return true.
    if ((nx instanceof NumberValue && R(nx) === -Infinity) || (ny instanceof NumberValue && R(ny) === +Infinity)) {
      return true;
    }
    // i. If nx is +∞ or ny is -∞, return false.
    if ((nx instanceof NumberValue && R(nx) === +Infinity) || (ny instanceof NumberValue && R(ny) === -Infinity)) {
      return false;
    }
    // j. If the mathematical value of nx is less than the mathematical value of ny, return true; otherwise return false.
    const a = R(nx);
    const b = R(ny);
    return a < b;
  }
}

/** https://tc39.es/ecma262/#sec-islooselyequal */
export function* IsLooselyEqual(x: Value, y: Value): PlainEvaluator<boolean> {
  // 1. If SameType(x, y) is true, then
  if (SameType(x, y)) {
    // a. Return the result of performing Strict Equality Comparison x === y.
    return IsStrictlyEqual(x, y);
  }
  // 2. If x is null and y is undefined, return true.
  if (x === Value.null && y === Value.undefined) {
    return true;
  }
  // 3. If x is undefined and y is null, return true.
  if (x === Value.undefined && y === Value.null) {
    return true;
  }
  // 4. If Type(x) is Number and Type(y) is String, return the result of the comparison x == ! ToNumber(y).
  if (x instanceof NumberValue && y instanceof JSStringValue) {
    return X(yield* IsLooselyEqual(x, X(ToNumber(y))));
  }
  // 5. If Type(x) is String and Type(y) is Number, return the result of the comparison ! ToNumber(x) == y.
  if (x instanceof JSStringValue && y instanceof NumberValue) {
    return X(yield* IsLooselyEqual(X(ToNumber(x)), y));
  }
  // 6. If Type(x) is BigInt and Type(y) is String, then
  if (x instanceof BigIntValue && y instanceof JSStringValue) {
    // a. Let n be StringToBigInt(y).
    const n = StringToBigInt(y);
    // b. If n is undefined, return false.
    if (n === undefined) {
      return false;
    }
    // c. Return the result of the comparison x == n.
    return X(yield* IsLooselyEqual(x, n));
  }
  // 7. If Type(x) is String and Type(y) is BigInt, return the result of the comparison y == x.
  if (x instanceof JSStringValue && y instanceof BigIntValue) {
    return X(yield* IsLooselyEqual(y, x));
  }
  // 8. If Type(x) is Boolean, return the result of the comparison ! ToNumber(x) == y.
  if (x instanceof BooleanValue) {
    return X(yield* IsLooselyEqual(X(ToNumber(x)), y));
  }
  // 9. If Type(y) is Boolean, return the result of the comparison x == ! ToNumber(y).
  if (y instanceof BooleanValue) {
    return X(yield* IsLooselyEqual(x, X(ToNumber(y))));
  }
  // 10. If Type(x) is either String, Number, BigInt, or Symbol and Type(y) is Object, return the result of the comparison x == ToPrimitive(y).
  if ((x instanceof JSStringValue || x instanceof NumberValue || x instanceof BigIntValue || x instanceof SymbolValue) && y instanceof ObjectValue) {
    return X(yield* IsLooselyEqual(x, Q(yield* ToPrimitive(y))));
  }
  // 11. If Type(x) is Object and Type(y) is either String, Number, BigInt, or Symbol, return the result of the comparison ToPrimitive(x) == y.
  if (x instanceof ObjectValue && (y instanceof JSStringValue || y instanceof NumberValue || y instanceof BigIntValue || y instanceof SymbolValue)) {
    return X(yield* IsLooselyEqual(Q(yield* ToPrimitive(x)), y));
  }
  // 12. If Type(x) is BigInt and Type(y) is Number, or if Type(x) is Number and Type(y) is BigInt, then
  if ((x instanceof BigIntValue && y instanceof NumberValue) || (x instanceof NumberValue && y instanceof BigIntValue)) {
    // a. If x or y are any of NaN, +∞, or -∞, return false.
    if ((x.isNaN && (x.isNaN() || !x.isFinite())) || (y.isNaN && (y.isNaN() || !y.isFinite()))) {
      return false;
    }
    // b. If the mathematical value of x is equal to the mathematical value of y, return true; otherwise return false.
    const a = R(x);
    const b = R(y);
    return a == b; // eslint-disable-line eqeqeq
  }
  // 13. Return false.
  return false;
}

/** https://tc39.es/ecma262/#sec-isstrictlyequal */
export function IsStrictlyEqual(x: Value, y: Value): boolean {
// 1. If SameType(x, y) is false, return false.
  if (!SameType(x, y)) {
    return false;
  }
  // 2. If x is a Number, then
  if (x instanceof NumberValue) {
    // a. Return Number::equal(x, y).
    return NumberValue.equal(x, y as NumberValue);
  }
  // 3. Return SameValueNonNumber(x, y).
  return SameValueNonNumber(x, y);
}
