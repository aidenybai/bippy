import { TrimString } from '../runtime-semantics/all.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { Value, type Arguments } from '../value.mts';
import {
  Assert,
  CreateBuiltinFunction,
  ToInt32,
  ToString,
  F, R,
  Realm,
} from '#self';

function digitToNumber(_digit: string) {
  let digit = _digit.charCodeAt(0);
  if (digit < 0x30 /* 0 */) {
    return NaN;
  }
  if (digit <= 0x39 /* 9 */) {
    return digit - 0x30;
  }
  // Convert to lower case.
  digit &= ~0x20; // eslint-disable-line no-bitwise
  if (digit < 0x41 /* A */) {
    return NaN;
  }
  if (digit <= 0x5a /* Z */) {
    return digit - 0x41 /* A */ + 10;
  }
  return NaN;
}

function stringToRadixNumber(str: string, R: number) {
  let num = 0;
  for (let i = 0; i < str.length; i += 1) {
    const power = str.length - i - 1;
    const multiplier = R ** power;
    const dig = digitToNumber(str[i]);
    Assert(!Number.isNaN(dig) && dig < R);
    num += dig * multiplier;
  }
  return num;
}

function searchNotRadixDigit(str: string, R: number) {
  for (let i = 0; i < str.length; i += 1) {
    const num = digitToNumber(str[i]);
    if (Number.isNaN(num) || num >= R) {
      return i;
    }
  }
  return str.length;
}

/** https://tc39.es/ecma262/#sec-parseint-string-radix */
function* ParseInt([string = Value.undefined, radix = Value.undefined]: Arguments): ValueEvaluator {
  const inputString = Q(yield* ToString(string));
  let radixMV = R(Q(yield* ToInt32(radix)));
  if (radixMV !== 0 && (radixMV < 2 || radixMV > 36)) return F(NaN);
  let trimmedString = X(TrimString(inputString, 'start'));
  if (trimmedString === '') return F(NaN);
  let sign = 1;
  if (trimmedString[0] === '\x2D') {
    sign = -1;
    trimmedString = trimmedString.slice(1);
  } else if (trimmedString[0] === '\x2B') {
    trimmedString = trimmedString.slice(1);
  }
  if (radixMV === 0 || radixMV === 16) {
    if (trimmedString.length >= 2 && trimmedString.slice(0, 2).toLowerCase() === '0x') {
      trimmedString = trimmedString.slice(2);
      radixMV = 16;
    }
    if (radixMV === 0) radixMV = 10;
  }
  const end = searchNotRadixDigit(trimmedString, radixMV);
  const numberString = trimmedString.slice(0, end);
  if (numberString === '') return F(NaN);
  const mathInt = stringToRadixNumber(numberString, radixMV);
  if (sign === -1 && mathInt === 0) return F(-0);
  return F(sign * mathInt);
}

export function bootstrapParseInt(realmRec: Realm) {
  realmRec.Intrinsics['%parseInt%'] = CreateBuiltinFunction(ParseInt, 2, Value('parseInt'), [], realmRec);
}
