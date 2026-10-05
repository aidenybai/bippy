import {
  ObjectValue,
  JSStringValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import {
  GetSubstitution,
  TrimString,
  StringPad,
  StringIndexOf,
} from '../runtime-semantics/all.mts';
import {
  CodePointAt,
  IsStringWellFormedUnicode,
  UTF16EncodeCodePoint,
} from '../static-semantics/all.mts';
import { Q, X } from '../completion.mts';
import type { ValueEvaluator, YieldEvaluator } from '../evaluator.mts';
import { clamp } from '../abstract-ops/math.mts';
import { assignProps } from './bootstrap.mts';
import {
  surroundingAgent,
  ArrayCreate,
  Assert,
  Call,
  CreateDataPropertyOrThrow,
  CreateIteratorFromClosure,
  Get,
  GetMethod,
  Invoke,
  IsCallable,
  IsRegExp,
  RegExpCreate,
  RequireObjectCoercible,
  ToIntegerOrInfinity,
  ToAbsoluteIndex,
  ToNumber,
  ToString,
  ToUint32,
  StringCreate,
  Throw,
  Yield,
  F, R, R as MathematicalValue,
  Realm,
  Unicode,
  ToClampedIndex,
} from '#self';

/** https://tc39.es/ecma262/#sec-thisstringvalue */
export function ThisStringValue(value: Value) {
  if (value instanceof JSStringValue) {
    return value;
  }
  if (value instanceof ObjectValue && 'StringData' in value) {
    const s = value.StringData;
    Assert(typeof s === 'string');
    return Value(s);
  }
  return Throw.TypeError('$1 is not a $2 object', value, 'String');
}

/** https://tc39.es/ecma262/#sec-string.prototype.charat */
function* StringProto_charAt([pos = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const position = Q(yield* ToIntegerOrInfinity(pos));
  const size = S.length;
  if (position < 0 || position >= size) {
    return Value('');
  }
  return Value(S[position]);
}

/** https://tc39.es/ecma262/#sec-string.prototype.charcodeat */
function* StringProto_charCodeAt([pos = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const position = Q(yield* ToIntegerOrInfinity(pos));
  const size = S.length;
  if (position < 0 || position >= size) {
    return F(NaN);
  }
  return F(S.charCodeAt(position));
}

/** https://tc39.es/ecma262/#sec-string.prototype.codepointat */
function* StringProto_codePointAt([pos = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const position = Q(yield* ToIntegerOrInfinity(pos));
  const size = S.length;
  if (position < 0 || position >= size) {
    return Value.undefined;
  }
  const cp = X(CodePointAt(S, position));
  return F(cp.CodePoint);
}

/** https://tc39.es/ecma262/#sec-string.prototype.concat */
function* StringProto_concat(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  let R = S;
  const _args = [...args];
  while (_args.length > 0) {
    const next = _args.shift()!;
    const nextString = Q(yield* ToString(next));
    R = `${R}${nextString}`;
  }
  return Value(R);
}

/** https://tc39.es/ecma262/#sec-string.prototype.endswith */
function* StringProto_endsWith([searchString = Value.undefined, endPosition = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const isRegExp = Q(yield* IsRegExp(searchString));
  if (isRegExp) {
    return Throw.TypeError('First argument to $1 must not be a regular expression', 'String.prototype.endsWith');
  }
  const searchStr = Q(yield* ToString(searchString));
  const length = string.length;
  const end = endPosition === Value.undefined ? length : clamp(0, Q(yield* ToIntegerOrInfinity(endPosition)), length);
  const searchLength = searchStr.length;
  const start = end - searchLength;
  if (start < 0) {
    return Value.false;
  }
  for (let i = 0; i < searchLength; i += 1) {
    if (string.charCodeAt(start + i) !== searchStr.charCodeAt(i)) {
      return Value.false;
    }
  }
  return Value.true;
}

/** https://tc39.es/ecma262/#sec-string.prototype.includes */
function* StringProto_includes([searchString = Value.undefined, position = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const isRegExp = Q(yield* IsRegExp(searchString));
  if (isRegExp) {
    return Throw.TypeError('First argument to $1 must not be a regular expression', 'String.prototype.includes');
  }
  const searchStr = Q(yield* ToString(searchString));
  const length = string.length;
  const start = clamp(0, Q(yield* ToIntegerOrInfinity(position)), length);
  Assert(!(position === Value.undefined) || start === 0);
  const searchLen = searchStr.length;
  let k = start;
  while (k + searchLen <= length) {
    let match = true;
    for (let j = 0; j < searchLen; j += 1) {
      if (searchStr[j] !== string[k + j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return Value.true;
    }
    k += 1;
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-string.prototype.indexof */
function* StringProto_indexOf([searchString = Value.undefined, position = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2. Let S be ? ToString(O).
  const string = Q(yield* ToString(O));
  // 3. Let searchStr be ? ToString(searchString).
  const searchStr = Q(yield* ToString(searchString));
  // 4. Let pos be ? ToIntegerOrInfinity(position).
  // 6. Let len be the length of S.
  const length = string.length;
  // 7. Let start be min(max(pos, 0), len).
  const start = clamp(0, Q(yield* ToIntegerOrInfinity(position)), length);
  Assert(!(position === Value.undefined) || start === 0);
  // 8. Return ! StringIndexOf(S, searchStr, start).
  return X(StringIndexOf(string, searchStr, start));
}

/** https://tc39.es/ecma262/#sec-string.prototype.iswellformed */
function* StringProto_isWellFormed(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2. Let S be ? ToString(O).
  const S = Q(yield* ToString(O));
  // 3. Return IsStringWellFormedUnicode(S).
  return IsStringWellFormedUnicode(S) ? Value.true : Value.false;
}

/** https://tc39.es/ecma262/#sec-string.prototype.lastindexof */
function* StringProto_lastIndexOf([searchString = Value.undefined, position = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const searchStr = Q(yield* ToString(searchString));
  const numberPosition = Q(yield* ToNumber(position));
  const length = string.length;
  const searchLength = searchStr.length;
  const maxStart = length - searchLength;
  if (maxStart < 0) {
    return F(-1);
  }
  const start = numberPosition.isNaN() ? maxStart : clamp(0, X(ToIntegerOrInfinity(numberPosition)), maxStart);
  Assert(!(position === Value.undefined) || start === maxStart);
  let k = start;
  while (k >= 0) {
    if (k + searchLength <= length) {
      let match = true;
      for (let j = 0; j < searchLength; j += 1) {
        if (searchStr[j] !== string[k + j]) {
          match = false;
          break;
        }
      }
      if (match) {
        return F(k);
      }
    }
    k -= 1;
  }
  return F(-1);
}

/** https://tc39.es/ecma262/#sec-string.prototype.localecompare */
function* StringProto_localeCompare([that = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Unicode.str_normalization(Q(yield* ToString(O)), 'NFC');
  const That = Unicode.str_normalization(Q(yield* ToString(that)), 'NFC');
  if (S === That) {
    return F(+0);
  } else if (S < That) {
    return F(-1);
  } else {
    return F(1);
  }
}

/** https://tc39.es/ecma262/#sec-string.prototype.match */
function* StringProto_match([regexp = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));

  if (regexp instanceof ObjectValue) {
    const matcher = Q(yield* GetMethod(regexp, wellKnownSymbols.match));
    if (matcher !== Value.undefined) {
      return Q(yield* Call(matcher, regexp, [O]));
    }
  }

  const S = Q(yield* ToString(O));
  const rx = Q(yield* RegExpCreate(regexp, Value.undefined));
  return Q(yield* Invoke(rx, wellKnownSymbols.match, [Value(S)]));
}

/** https://tc39.es/ecma262/#sec-string.prototype.matchall */
function* StringProto_matchAll([regexp = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2. If regexp is an Object, then
  if (regexp instanceof ObjectValue) {
    // a. Let isRegExp be ? IsRegExp(regexp).
    const isRegExp = Q(yield* IsRegExp(regexp));
    // b. If isRegExp is true, then
    if (isRegExp) {
      // i. Let flags be ? Get(regexp, "flags").
      const flags = Q(yield* Get(regexp as ObjectValue, 'flags'));
      // ii. Perform ? RequireObjectCoercible(flags).
      Q(RequireObjectCoercible(flags));
      // iii. If ? ToString(flags) does not contain "g", throw a TypeError exception.
      if (!Q(yield* ToString(flags)).includes('g')) {
        return Throw.TypeError('The RegExp passed to String.prototype.$1 must have the global flag', 'matchAll');
      }
    }
    // c. Let matcher be ? GetMethod(regexp, @@matchAll).
    const matcher = Q(yield* GetMethod(regexp, wellKnownSymbols.matchAll));
    // d. If matcher is not undefined, then
    if (matcher !== Value.undefined) {
      // i. Return ? Call(matcher, regexp, « O »).
      return Q(yield* Call(matcher, regexp, [O]));
    }
  }
  // 3. Let S be ? ToString(O).
  const S = Q(yield* ToString(O));
  // 4. Let rx be ? RegExpCreate(regexp, "g").
  const rx = Q(yield* RegExpCreate(regexp, Value('g')));
  // 5. Return ? Invoke(rx, @@matchAll, « S »).
  return Q(yield* Invoke(rx, wellKnownSymbols.matchAll, [Value(S)]));
}

/** https://tc39.es/ecma262/#sec-string.prototype.normalize */
function* StringProto_normalize([form = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  let f: string;
  if (form === Value.undefined) {
    f = 'NFC';
  } else {
    f = Q(yield* ToString(form));
  }
  if (f !== 'NFC' && f !== 'NFD' && f !== 'NFKC' && f !== 'NFKD') {
    return Throw.RangeError('Invalid normalization form');
  }
  const ns = Unicode.str_normalization(S, f);
  return Value(ns);
}

/** https://tc39.es/ecma262/#sec-string.prototype.padend */
function* StringProto_padEnd([maxLength = Value.undefined, fillString = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  return Value(Q(yield* StringPad(O, maxLength, fillString, 'end')));
}

/** https://tc39.es/ecma262/#sec-string.prototype.padstart */
function* StringProto_padStart([maxLength = Value.undefined, fillString = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  return Value(Q(yield* StringPad(O, maxLength, fillString, 'start')));
}

/** https://tc39.es/ecma262/#sec-string.prototype.repeat */
function* StringProto_repeat([count = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const n = Q(yield* ToIntegerOrInfinity(count));
  if (n < 0) {
    return Throw.RangeError('Count $1 is invalid', n);
  }
  if (n === Infinity || n === -Infinity) {
    return Throw.RangeError('Count $1 is invalid', n);
  }
  if (n === 0) {
    return Value('');
  }
  let T = '';
  for (let i = 0; i < n; i += 1) {
    T += S;
  }
  return Value(T);
}

/** https://tc39.es/ecma262/#sec-string.prototype.replace */
function* StringProto_replace([searchValue = Value.undefined, replaceValue = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  if (searchValue instanceof ObjectValue) {
    const replacer = Q(yield* GetMethod(searchValue, wellKnownSymbols.replace));
    if (replacer !== Value.undefined) {
      return Q(yield* Call(replacer, searchValue, [O, replaceValue]));
    }
  }
  const string = Q(yield* ToString(O));
  const searchString = Q(yield* ToString(searchValue));
  const functionalReplace = IsCallable(replaceValue);
  let replacementValue: string | undefined;
  if (!functionalReplace) {
    replacementValue = Q(yield* ToString(replaceValue));
  }
  const searchLength = searchString.length;
  const position = string.indexOf(searchString, 0);
  if (position === -1) {
    return Value(string);
  }
  const preceding = string.slice(0, position);
  const following = string.slice(position + searchLength);
  let replacement: string;
  if (functionalReplace) {
    replacement = Q(yield* ToString(Q(yield* Call(replaceValue, Value.undefined, [Value(searchString), F(position), Value(string)]))));
  } else {
    Assert(typeof replacementValue === 'string');
    const captures: readonly (string | undefined)[] = [];
    replacement = X(GetSubstitution(searchString, string, position, captures, undefined, replacementValue));
  }
  return Value(preceding + replacement + following);
}

/** https://tc39.es/ecma262/#sec-string.prototype.replaceall */
function* StringProto_replaceAll([searchValue = Value.undefined, replaceValue = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2.If searchValue is an Object, then
  if (searchValue instanceof ObjectValue) {
    // a. Let isRegExp be ? IsRegExp(searchValue).
    const isRegExp = Q(yield* IsRegExp(searchValue));
    // b. If isRegExp is true, then
    if (isRegExp) {
      // i. Let flags be ? Get(searchValue, "flags").
      const flags = Q(yield* Get(searchValue as ObjectValue, 'flags'));
      // ii. Perform ? RequireObjectCoercible(flags).
      Q(RequireObjectCoercible(flags));
      // iii. If ? ToString(flags) does not contain "g", throw a TypeError exception.
      if (!Q(yield* ToString(flags)).includes('g')) {
        return Throw.TypeError('The RegExp passed to String.prototype.$1 must have the global flag', 'replaceAll');
      }
    }
    // c. Let replacer be ? GetMethod(searchValue, @@replace).
    const replacer = Q(yield* GetMethod(searchValue, wellKnownSymbols.replace));
    // d. If replacer is not undefined, then
    if (replacer !== Value.undefined) {
      // i. Return ? Call(replacer, searchValue, « O, replaceValue »).
      return Q(yield* Call(replacer, searchValue, [O, replaceValue]));
    }
  }
  // 3. Let string be ? ToString(O).
  const string = Q(yield* ToString(O));
  // 4. Let searchString be ? ToString(searchValue).
  const searchString = Q(yield* ToString(searchValue));
  // 5. Let functionalReplace be IsCallable(replaceValue).
  const functionalReplace = IsCallable(replaceValue);
  // 6. If functionalReplace is false, then
  if (!functionalReplace) {
    // a. Let replaceValue be ? ToString(replaceValue).
    replaceValue = Value(Q(yield* ToString(replaceValue)));
  }
  // 7. Let searchLength be the length of searchString.
  const searchLength = searchString.length;
  // 8. Let advanceBy be max(1, searchLength).
  const advanceBy = Math.max(1, searchLength);
  // 9. Let matchPositions be a new empty List.
  const matchPositions = [];
  // 10. Let position be ! StringIndexOf(string, searchString, 0).
  let position = R(X(StringIndexOf(string, searchString, 0)));
  // 11. Repeat, while position is not -1
  while (position !== -1) {
    // a. Append position to the end of matchPositions.
    matchPositions.push(position);
    // b. Let position be ! StringIndexOf(string, searchString, position + advanceBy).
    position = R(X(StringIndexOf(string, searchString, position + advanceBy)));
  }
  // 12. Let endOfLastMatch be 0.
  let endOfLastMatch = 0;
  // 13. Let result be the empty string value.
  let result = '';
  // 14. For each position in matchPositions, do
  for (position of matchPositions) {
    let replacement;
    // a. If functionalReplace is true, then
    if (functionalReplace) {
      // i. Let replacement be ? ToString(? Call(replaceValue, undefined, « searchString, 𝔽(position), string »).
      replacement = Q(yield* ToString(Q(yield* Call(replaceValue, Value.undefined, [Value(searchString), F(position), Value(string)]))));
    } else { // b. Else,
      // i. Assert: Type(replaceValue) is String.
      Assert(replaceValue instanceof JSStringValue);
      // ii. Let captures be a new empty List.
      const captures: readonly (string | undefined)[] = [];
      // iii. Let replacement be GetSubstitution(searchString, string, position, captures, undefined, replaceValue).
      replacement = X(GetSubstitution(searchString, string, position, captures, undefined, replaceValue.stringValue()));
    }
    // c. Let stringSlice be the substring of string consisting of the code units from endOfLastMatch (inclusive) up through position (exclusive).
    const stringSlice = string.slice(endOfLastMatch, position);
    // d. Let result be the string-concatenation of result, stringSlice, and replacement.
    result = result + stringSlice + replacement;
    // e. Let endOfLastMatch be position + searchLength.
    endOfLastMatch = position + searchLength;
  }
  // 15. If endOfLastMatch < the length of string, then
  if (endOfLastMatch < string.length) {
    // a. Let result be the string-concatenation of result and the substring of string consisting of the code units from endOfLastMatch (inclusive) up through the final code unit of string (inclusive).
    result += string.slice(endOfLastMatch);
  }
  // 16. Return result.
  return Value(result);
}

/** https://tc39.es/ecma262/#sec-string.prototype.slice */
function* StringProto_search([regexp = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));

  if (regexp instanceof ObjectValue) {
    const searcher = Q(yield* GetMethod(regexp, wellKnownSymbols.search));
    if (searcher !== Value.undefined) {
      return Q(yield* Call(searcher, regexp, [O]));
    }
  }

  const string = Q(yield* ToString(O));
  const rx = Q(yield* RegExpCreate(regexp, Value.undefined));
  return Q(yield* Invoke(rx, wellKnownSymbols.search, [Value(string)]));
}

/** https://tc39.es/ecma262/#sec-string.prototype.slice */
function* StringProto_slice([start = Value.undefined, end = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const length = string.length;
  const from = Q(yield* ToClampedIndex(start, length));
  const to = end === Value.undefined ? length : Q(yield* ToClampedIndex(end, length));
  if (from >= to) return Value('');
  return Value(string.slice(from, to));
}

/** https://tc39.es/ecma262/#sec-string.prototype.split */
function* StringProto_split([separator = Value.undefined, limit = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  if (separator instanceof ObjectValue) {
    const splitter = Q(yield* GetMethod(separator, wellKnownSymbols.split));
    if (splitter !== Value.undefined) {
      return Q(yield* Call(splitter, separator, [O, limit]));
    }
  }
  const S = Q(yield* ToString(O));
  const A = X(ArrayCreate(0));
  let lengthA = 0;
  let lim;
  if (limit === Value.undefined) {
    lim = F((2 ** 32) - 1);
  } else {
    lim = Q(yield* ToUint32(limit));
  }
  const s = S.length;
  let p = 0;
  const R = Q(yield* ToString(separator));
  if (MathematicalValue(lim) === 0) {
    return A;
  }
  if (separator === Value.undefined) {
    X(CreateDataPropertyOrThrow(A, '0', Value(S)));
    return A;
  }
  if (s === 0) {
    if (R !== '') {
    X(CreateDataPropertyOrThrow(A, '0', Value(S)));
    }
    return A;
  }
  let q = p;
  while (q !== s) {
    const e = yield* SplitMatch(S, q, R);
    if (e === false) {
      q += 1;
    } else {
      if (e === p) {
        q += 1;
      } else {
        const T = Value(S.substring(p, q));
        X(CreateDataPropertyOrThrow(A, X(ToString(F(lengthA))), T));
        lengthA += 1;
        if (lengthA === MathematicalValue(lim)) {
          return A;
        }
        p = e;
        q = p;
      }
    }
  }
  const T = Value(S.substring(p, s));
  X(CreateDataPropertyOrThrow(A, X(ToString(F(lengthA))), T));
  return A;
}

function* SplitMatch(S: string, q: number, R: string) {
  Assert(typeof R === 'string');
  const r = R.length;
  const s = S.length;
  if (q + r > s) {
    return false;
  }
  for (let i = 0; i < r; i += 1) {
    if (S.charCodeAt(q + i) !== R.charCodeAt(i)) {
      return false;
    }
  }
  return q + r;
}

/** https://tc39.es/ecma262/#sec-string.prototype.startswith */
function* StringProto_startsWith([searchString = Value.undefined, position = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const isRegExp = Q(yield* IsRegExp(searchString));
  if (isRegExp) {
    return Throw.TypeError('First argument to $1 must not be a regular expression', 'String.prototype.startsWith');
  }
  const searchStr = Q(yield* ToString(searchString));
  const length = string.length;
  const start = clamp(0, Q(yield* ToIntegerOrInfinity(position)), length);
  Assert(!(position === Value.undefined) || start === 0);
  const searchLength = searchStr.length;
  if (searchLength + start > length) {
    return Value.false;
  }
  for (let i = 0; i < searchLength; i += 1) {
    if (string.charCodeAt(start + i) !== searchStr.charCodeAt(i)) {
      return Value.false;
    }
  }
  return Value.true;
}

/** https://tc39.es/ecma262/#sec-string.prototype.substring */
function* StringProto_substring([start = Value.undefined, end = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const length = string.length;
  const finalStart = clamp(0, Q(yield* ToIntegerOrInfinity(start)), length);
  Assert(!(start === Value.undefined) || finalStart === 0);
  const finalEnd = end === Value.undefined ? length : clamp(0, Q(yield* ToIntegerOrInfinity(end)), length);
  const from = Math.min(finalStart, finalEnd);
  const to = Math.max(finalStart, finalEnd);
  return Value(string.slice(from, to));
}

/** https://tc39.es/ecma262/#sec-string.prototype.tolocalelowercase */
function* StringProto_toLocaleLowerCase(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const L = Unicode.str_toLocaleLowercase(S);
  return Value(L);
}

/** https://tc39.es/ecma262/#sec-string.prototype.tolocaleuppercase */
function* StringProto_toLocaleUpperCase(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const L = Unicode.str_toLocaleUppercase(S);
  return Value(L);
}

/** https://tc39.es/ecma262/#sec-string.prototype.tolowercase */
function* StringProto_toLowerCase(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const L = Unicode.str_toLowercase(S);
  return Value(L);
}

/** https://tc39.es/ecma262/#sec-string.prototype.tostring */
function* StringProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return Q(ThisStringValue(thisValue));
}

/** https://tc39.es/ecma262/#sec-string.prototype.touppercase */
function* StringProto_toUpperCase(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const S = Q(yield* ToString(O));
  const L = Unicode.str_toUppercase(S);
  return Value(L);
}

/** https://tc39.es/ecma262/#sec-string.prototype.towellformed */
function* StringProto_toWellFormed(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2. Let S be ? ToString(O).
  const S = Q(yield* ToString(O));
  // 3. Let strLen be the length of S.
  const strLen = S.length;
  // 4. Let k be 0.
  let k = 0;
  // 5. Let result be the empty String.
  let result = '';
  // 6. Repeat, while k < strLen,
  while (k < strLen) {
    // a. Let cp be CodePointAt(S, k).
    const cp = CodePointAt(S, k);
    // b. If cp.[[IsUnpairedSurrogate]] is true, then
    if (cp.IsUnpairedSurrogate) {
      // i. Set result to the string-concatenation of result and 0xFFFD (REPLACEMENT CHARACTER).
      result += '\uFFFD';
    } else { // c. Else,
      // i. Set result to the string-concatenation of result and UTF16EncodeCodePoint(cp.[[CodePoint]]).
      result += UTF16EncodeCodePoint(cp.CodePoint);
    }
    // d. Set k to k + cp.[[CodeUnitCount]].
    k += cp.CodeUnitCount;
  }
  // 7. Return result.
  return Value(result);
}

/** https://tc39.es/ecma262/#sec-string.prototype.trim */
function* StringProto_trim(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const S = thisValue;
  return Value(Q(yield* TrimString(S, 'start+end')));
}

/** https://tc39.es/ecma262/#sec-string.prototype.trimend */
function* StringProto_trimEnd(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const S = thisValue;
  return Value(Q(yield* TrimString(S, 'end')));
}

/** https://tc39.es/ecma262/#sec-string.prototype.trimstart */
function* StringProto_trimStart(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const S = thisValue;
  return Value(Q(yield* TrimString(S, 'start')));
}

/** https://tc39.es/ecma262/#sec-string.prototype.valueof */
function* StringProto_valueOf(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  return Q(ThisStringValue(thisValue));
}

/** https://tc39.es/ecma262/#sec-string.prototype-@@iterator */
function* StringProto_iterator(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  // 2. Let s be ? ToString(O).
  const s = Q(yield* ToString(O));
  // 3. Let closure be a new Abstract Closure with no parameters that captures s and performs the following steps when called:
  const closure = function* closure(): YieldEvaluator {
    // a. Let position be 0.
    let position = 0;
    // b. Let len be the length of s.
    const len = s.length;
    // c. Repeat, while position < len,
    while (position < len) {
      // i. Let cp be ! CodePointAt(s, position).
      const cp = X(CodePointAt(s, position));
      // ii. Let nextIndex be position + cp.[[CodeUnitCount]].
      const nextIndex = position + cp.CodeUnitCount;
      // iii. Let resultString be the substring of s from position to nextIndex.
      const resultString = Value(s.slice(position, nextIndex));
      // iv. Set position to nextIndex.
      position = nextIndex;
      // v. Perform ? Yield(resultString).
      Q(yield* Yield(resultString));
    }
    // NON-SPEC
    generator.HostCapturedValues = undefined;
    // d. Return undefined.
    return Value.undefined;
  };
  // 4. Return ! CreateIteratorFromClosure(closure, "%StringIteratorPrototype%", %StringIteratorPrototype%).
  const generator = X(CreateIteratorFromClosure(closure, '%StringIteratorPrototype%', surroundingAgent.intrinsic('%StringIteratorPrototype%'), ['HostCapturedValues'], [O]));
  return generator;
}

/** https://tc39.es/ecma262/#sec-string.prototype.at */
function* StringProto_at([index = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const O = thisValue;
  Q(RequireObjectCoercible(O));
  const string = Q(yield* ToString(O));
  const length = string.length;
  const k = Q(yield* ToAbsoluteIndex(index, length));
  // 7. If k < 0 or k ≥ len, then return undefined.
  if (k < 0 || k >= length) {
    return Value.undefined;
  }
  // 8. Return the String value consisting of only the code unit at position k in S.
  return Value(string[k]);
}

export function bootstrapStringPrototype(realmRec: Realm) {
  const proto = StringCreate('', realmRec.Intrinsics['%Object.prototype%']);

  assignProps(realmRec, proto, [
    ['charAt', StringProto_charAt, 1],
    ['charCodeAt', StringProto_charCodeAt, 1],
    ['codePointAt', StringProto_codePointAt, 1],
    ['concat', StringProto_concat, 1],
    ['endsWith', StringProto_endsWith, 1],
    ['includes', StringProto_includes, 1],
    ['indexOf', StringProto_indexOf, 1],
    ['isWellFormed', StringProto_isWellFormed, 0],
    ['at', StringProto_at, 1],
    ['lastIndexOf', StringProto_lastIndexOf, 1],
    ['localeCompare', StringProto_localeCompare, 1],
    ['match', StringProto_match, 1],
    ['matchAll', StringProto_matchAll, 1],
    ['normalize', StringProto_normalize, 0],
    ['padEnd', StringProto_padEnd, 1],
    ['padStart', StringProto_padStart, 1],
    ['repeat', StringProto_repeat, 1],
    ['replace', StringProto_replace, 2],
    ['replaceAll', StringProto_replaceAll, 2],
    ['search', StringProto_search, 1],
    ['slice', StringProto_slice, 2],
    ['split', StringProto_split, 2],
    ['startsWith', StringProto_startsWith, 1],
    ['substring', StringProto_substring, 2],
    ['toLocaleLowerCase', StringProto_toLocaleLowerCase, 0],
    ['toLocaleUpperCase', StringProto_toLocaleUpperCase, 0],
    ['toLowerCase', StringProto_toLowerCase, 0],
    ['toString', StringProto_toString, 0],
    ['toUpperCase', StringProto_toUpperCase, 0],
    ['toWellFormed', StringProto_toWellFormed, 0],
    ['trim', StringProto_trim, 0],
    ['trimEnd', StringProto_trimEnd, 0],
    ['trimStart', StringProto_trimStart, 0],
    ['valueOf', StringProto_valueOf, 0],
    [wellKnownSymbols.iterator, StringProto_iterator, 0],
  ]);

  realmRec.Intrinsics['%String.prototype%'] = proto;
}
