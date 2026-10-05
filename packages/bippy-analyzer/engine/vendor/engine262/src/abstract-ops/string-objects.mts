import {
  Descriptor,
  ObjectValue,
  SymbolValue,
  JSStringValue,
  Value,
  type PropertyKeyValue,
  type ObjectInternalMethods,
} from '../value.mts';
import { X } from '../completion.mts';
import type { StringObject } from '../intrinsics/String.mts';
import type { Mutable } from '../utils/language.mts';
import {
  Assert,
  CanonicalNumericIndexString,
  DefinePropertyOrThrow,
  IsIntegralNumber,
  IsPropertyKey,
  MakeBasicObject,
  OrdinaryGetOwnProperty,
  OrdinaryDefineOwnProperty,
  IsCompatiblePropertyDescriptor,
  ToIntegerOrInfinity,
  ToString,
  isArrayIndex,
  F, R,
  type FullyPopulatedDataDescriptor,
} from './all.mts';
import type { PlainEvaluator } from '#self';

const InternalMethods = {
  * GetOwnProperty(P) {
    const S = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    Assert(typeof P === 'string' || IsPropertyKey(P));
    const desc = OrdinaryGetOwnProperty(S, P);
    if (desc) return desc;
    return StringGetOwnProperty(S, P);
  },
  * DefineOwnProperty(P, Desc) {
    const S = this;
    if (P instanceof JSStringValue) P = P.stringValue();
    Assert(typeof P === 'string' || IsPropertyKey(P));
    const stringDesc = X(StringGetOwnProperty(S, P));
    if (stringDesc) {
      const extensible = S.Extensible;
      return X(IsCompatiblePropertyDescriptor(extensible, Desc, stringDesc));
    }
    return X(OrdinaryDefineOwnProperty(S, P, Desc));
  },
  * OwnPropertyKeys(): PlainEvaluator<PropertyKeyValue[]> {
    const O = this;
    const keys: PropertyKeyValue[] = [];
    const str = O.StringData;
    Assert(typeof str === 'string');
    const len = str.length;

    // 5. For each non-negative integer i starting with 0 such that i < len, in ascending order, do
    for (let i = 0; i < len; i += 1) {
      // a. Add ! ToString(𝔽(i)) as the last element of keys.
      keys.push(Value(X(ToString(F(i)))));
    }

    // For each own property key P of O such that P is an array index and
    // ToIntegerOrInfinity(P) ≥ len, in ascending numeric index order, do
    //   Add P as the last element of keys.
    for (const P of O.properties.keys()) {
      // This is written with two nested ifs to work around https://github.com/devsnek/engine262/issues/24
      if (isArrayIndex(P)) {
        if (X(ToIntegerOrInfinity(P)) >= len) {
          keys.push(P);
        }
      }
    }

    // For each own property key P of O such that Type(P) is String and
    // P is not an array index, in ascending chronological order of property creation, do
    //   Add P as the last element of keys.
    for (const P of O.properties.keys()) {
      if (P instanceof JSStringValue && isArrayIndex(P) === false) {
        keys.push(P);
      }
    }

    // For each own property key P of O such that Type(P) is Symbol,
    // in ascending chronological order of property creation, do
    //   Add P as the last element of keys.
    for (const P of O.properties.keys()) {
      if (P instanceof SymbolValue) {
        keys.push(P);
      }
    }

    return keys;
  },
} satisfies Partial<ObjectInternalMethods<StringObject>>;

/** https://tc39.es/ecma262/#sec-stringcreate */
export function StringCreate(value: string, prototype: ObjectValue) {
  // 1. Assert: Type(value) is String.
  Assert(typeof value === 'string');
  // 2. Let S be ! MakeBasicObject(« [[Prototype]], [[Extensible]], [[StringData]] »).
  const S = X(MakeBasicObject(['Prototype', 'Extensible', 'StringData'])) as Mutable<StringObject>;
  // 3. Set S.[[Prototype]] to prototype.
  S.Prototype = prototype;
  // 4. Set S.[[StringData]] to value.
  S.StringData = value;
  // 5. Set S.[[GetOwnProperty]] as specified in 9.4.3.1.
  S.GetOwnProperty = InternalMethods.GetOwnProperty;
  // 6. Set S.[[DefineOwnProperty]] as specified in 9.4.3.2.
  S.DefineOwnProperty = InternalMethods.DefineOwnProperty;
  // 7. Set S.[[OwnPropertyKeys]] as specified in 9.4.3.3.
  S.OwnPropertyKeys = InternalMethods.OwnPropertyKeys;
  // 8. Let length be the number of code unit elements in value.
  const length = value.length;
  // 9. Perform ! DefinePropertyOrThrow(S, "length", PropertyDescriptor { [[Value]]: length, [[Writable]]: false, [[Enumerable]]: false, [[Configurable]]: false }).
  X(DefinePropertyOrThrow(S, 'length', Descriptor({
    Value: F(length),
    Writable: false,
    Enumerable: false,
    Configurable: false,
  })));
  // 10. Return S.
  return S;
}

/** https://tc39.es/ecma262/#sec-stringgetownproperty */
export function StringGetOwnProperty(S: ObjectValue, P: string | PropertyKeyValue): FullyPopulatedDataDescriptor | undefined {
  Assert(S instanceof ObjectValue && 'StringData' in S);
  Assert(IsPropertyKey(P) || typeof P === 'string');
  if (P instanceof JSStringValue) P = P.stringValue();
  if (typeof P !== 'string') return undefined;
  const index = X(CanonicalNumericIndexString(P));
  if (index === undefined) {
    return undefined;
  }
  if (!IsIntegralNumber(index)) {
    return undefined;
  }
  if (Object.is(index.value, -0)) {
    return undefined;
  }
  const str = S.StringData;
  Assert(typeof str === 'string');
  const len = str.length;
  if (R(index) < 0 || len <= R(index)) {
    return undefined;
  }
  const resultStr = str[R(index)];
  return Descriptor({
    Value: Value(resultStr),
    Writable: false,
    Enumerable: true,
    Configurable: false,
  });
}
