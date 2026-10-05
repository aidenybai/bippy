import {
  NullValue,
  JSStringValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
  NumberValue,
} from '../value.mts';
import { RegExpState, GetSubstitution } from '../runtime-semantics/all.mts';
import { CodePointAt } from '../static-semantics/all.mts';
import {
  Q, X, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { CreateRegExpStringIterator } from './RegExpStringIteratorPrototype.mts';
import { isRegExpObject, type RegExpObject } from './RegExp.mts';
import { surroundingAgent, UndefinedValue } from '#self';
import {
  ArrayCreate,
  Assert,
  Call,
  Construct,
  CreateDataProperty,
  CreateDataPropertyOrThrow,
  EscapeRegExpPattern,
  Get,
  GetMatchString,
  GetStringIndex,
  IsCallable,
  LengthOfArrayLike,
  MakeMatchIndicesIndexPairArray,
  OrdinaryObjectCreate,
  RequireInternalSlot,
  SameValue,
  Set,
  SpeciesConstructor,
  ToBoolean,
  ToIntegerOrInfinity,
  ToLength,
  ToObject,
  ToString,
  ToUint32,
  RegExpHasFlag,
  F, R, R as MathematicalValue,
  Realm,
  Throw,
  type MatchRecord,
  type OrdinaryObject,
} from '#self';


/** https://tc39.es/ecma262/#sec-regexp.prototype.exec */
function* RegExpProto_exec([string = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const R = thisValue as RegExpObject;
  Q(RequireInternalSlot(R, 'RegExpMatcher'));
  const S = Q(yield* ToString(string));
  return Q(yield* RegExpBuiltinExec(R, S));
}

/** https://tc39.es/ecma262/#sec-regexpexec */
export function* RegExpExec(R: ObjectValue, S: string) {
  Assert(R instanceof ObjectValue);
  Assert(typeof S === 'string');

  const exec = Q(yield* Get(R, 'exec'));
  if (IsCallable(exec)) {
    const result = Q(yield* Call(exec, R, [Value(S)]));
    if (!(result instanceof ObjectValue) && !(result instanceof NullValue)) {
      return Throw.TypeError('$1 is not object or null', result);
    }
    return result;
  }
  Q(RequireInternalSlot(R, 'RegExpMatcher'));
  return Q(yield* RegExpBuiltinExec(R as RegExpObject, S));
}

/** https://tc39.es/ecma262/#sec-regexpbuiltinexec */
export function* RegExpBuiltinExec(R: RegExpObject, S: string): ValueEvaluator<NullValue | OrdinaryObject> {
  // Let length be the number of code units in S.
  const length = S.length;
  let lastIndex = MathematicalValue(Q(yield* ToLength(X(Get(R, 'lastIndex')))));
  const flags = R.OriginalFlags;
  const global = flags.includes('g');
  const sticky = flags.includes('y');
  const hasIndices = flags.includes('d');
  if (!global && !sticky) {
    lastIndex = 0;
  }
  const matcher = R.RegExpMatcher;
  const fullUnicode = flags.includes('u') || flags.includes('v');
  let matchSucceeded = false;
  // If fullUnicode is true, let input be StringToCodePoints(S). Otherwise, let input be a List whose elements are the code units that are the elements of S.
  const input = RegExpState.createRegExpMatchingSource(fullUnicode ? Array.from(S) : S.split(''), S);

  // used to calculate inputIndex below
  const accumulatedInputLength: number[] = [];
  if (fullUnicode) {
    for (let index = 0; index < input.length; index += 1) {
      const codePoint = input[index];
      accumulatedInputLength[index] = (accumulatedInputLength[index - 1] ?? 0) + codePoint.length;
    }
  }
  let r;
  while (matchSucceeded === false) {
    if (lastIndex > length) {
      if (global || sticky) {
        Q(yield* Set(R, 'lastIndex', F(+0), true));
      }
      return Value.null;
    }
    // Let inputIndex be the index into input of the character that was obtained from element lastIndex of S.
    let inputIndex;
    if (fullUnicode) {
      inputIndex = accumulatedInputLength.findIndex((x) => lastIndex < x);
      if (inputIndex === -1) {
        // lastIndex is greater than all code points
        inputIndex = accumulatedInputLength.length;
      }
    } else {
      inputIndex = lastIndex;
    }

    r = matcher(input, inputIndex);
    if (r === 'failure') {
      if (sticky) {
        Q(yield* Set(R, 'lastIndex', F(+0), true));
        return Value.null;
      }
      lastIndex = AdvanceStringIndex(S, lastIndex, fullUnicode);
    } else {
      Assert(r instanceof RegExpState);
      matchSucceeded = true;
    }
  }
  __ts_cast__<RegExpState>(r);
  let e = r.endIndex;
  if (fullUnicode) {
    e = GetStringIndex(S, input, e);
  }
  if (global || sticky) {
    Q(yield* Set(R, 'lastIndex', F(e), true));
  }
  // Let n be the number of elements in r's captures List.
  // Note: this list is used as 1-indexed, so the 0th element is a hole and do not count as "the number of elements"
  const n = Math.max(0, r.captures.length - 1);
  Assert(r.captures[0] === undefined);
  Assert(n === R.RegExpRecord.CapturingGroupsCount);
  Assert(n < (2 ** 32) - 1);
  const A = X(ArrayCreate(n + 1));
  Assert(MathematicalValue(X(Get(A, 'length')) as NumberValue) === n + 1);
  X(CreateDataPropertyOrThrow(A, 'index', F(lastIndex)));
  X(CreateDataPropertyOrThrow(A, 'input', Value(S)));
  const match: MatchRecord = { StartIndex: lastIndex, EndIndex: e };
  const indices: (MatchRecord | undefined)[] = [];
  const groupNames: (string | undefined)[] = [];
  indices.push(match);
  const matchedSubStr = GetMatchString(S, match);
  X(CreateDataPropertyOrThrow(A, '0', Value(matchedSubStr)));
  let groups;
  let hasGroups: boolean;
  if (R.parsedPattern.capturingGroups.filter((x) => x.GroupName).length > 0) {
    groups = OrdinaryObjectCreate(Value.null);
    hasGroups = true;
  } else {
    groups = Value.undefined;
    hasGroups = false;
  }
  X(CreateDataPropertyOrThrow(A, 'groups', groups));
  const matchedGroupNames: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const captureI = r.captures[i];
    let capturedValue: Value;
    if (!captureI) {
      capturedValue = Value.undefined;
      indices.push(undefined);
    } else {
      let captureStart = captureI.startIndex;
      let captureEnd = captureI.endIndex;
      if (fullUnicode) {
        captureStart = GetStringIndex(S, input, captureStart);
        captureEnd = GetStringIndex(S, input, captureEnd);
      }
      const capture: MatchRecord = { StartIndex: captureStart, EndIndex: captureEnd };
      capturedValue = Value(GetMatchString(S, capture));
      indices.push(capture);
    }
    X(CreateDataPropertyOrThrow(A, X(ToString(F(i))), capturedValue));
    const i_th = i - 1;
    if (R.parsedPattern.capturingGroups[i_th].GroupName) {
      const s = R.parsedPattern.capturingGroups[i_th].GroupName;
      if (matchedGroupNames.includes(s)) {
        Assert(capturedValue === Value.undefined);
        groupNames.push(undefined);
      } else {
        if (capturedValue !== Value.undefined) {
          matchedGroupNames.push(s);
        }
        X(CreateDataPropertyOrThrow(groups as ObjectValue, s, capturedValue));
        groupNames.push(s);
      }
    } else {
      groupNames.push(undefined);
    }
  }
  if (hasIndices) {
    const indicesArray = MakeMatchIndicesIndexPairArray(S, indices, groupNames, hasGroups);
    X(CreateDataPropertyOrThrow(A, 'indices', indicesArray));
  }
  return A;
}

/** https://tc39.es/ecma262/#sec-advancestringindex */
export function AdvanceStringIndex(S: string, index: number, unicode: boolean) {
  Assert(index <= (2 ** 53) - 1);
  if (!unicode) {
    return index + 1;
  }
  const length = S.length;
  if (index + 1 >= length) {
    return index + 1;
  }
  const cp = CodePointAt(S, index);
  return index + cp.CodeUnitCount;
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.dotAll */
function RegExpProto_dotAllGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x0073 (LATIN SMALL LETTER S).
  const cu = 's';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.flags */
function* RegExpProto_flagsGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const R = thisValue;
  if (!(R instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  let result = '';
  const hasIndices = ToBoolean(Q(yield* Get(R, 'hasIndices')));
  if (hasIndices) {
    result += 'd';
  }
  const global = ToBoolean(Q(yield* Get(R, 'global')));
  if (global) {
    result += 'g';
  }
  const ignoreCase = ToBoolean(Q(yield* Get(R, 'ignoreCase')));
  if (ignoreCase) {
    result += 'i';
  }
  const multiline = ToBoolean(Q(yield* Get(R, 'multiline')));
  if (multiline) {
    result += 'm';
  }
  const dotAll = ToBoolean(Q(yield* Get(R, 'dotAll')));
  if (dotAll) {
    result += 's';
  }
  const unicode = ToBoolean(Q(yield* Get(R, 'unicode')));
  if (unicode) {
    result += 'u';
  }
  const unicodeSet = ToBoolean(Q(yield* Get(R, 'unicodeSets')));
  if (unicodeSet) {
    result += 'v';
  }
  const sticky = ToBoolean(Q(yield* Get(R, 'sticky')));
  if (sticky) {
    result += 'y';
  }
  return Value(result);
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.global */
function RegExpProto_globalGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const R = thisValue as RegExpObject;
  if (!(R instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  if (!('OriginalFlags' in R)) {
    if (SameValue(R, surroundingAgent.intrinsic('%RegExp.prototype%'))) {
      return Value.undefined;
    }
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  const flags = R.OriginalFlags;
  if (flags.includes('g')) {
    return Value.true;
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.hasIndices */
function RegExpProto_hasIndicesGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x0073 (LATIN SMALL LETTER D).
  const cu = 'd';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.ignorecase */
function RegExpProto_ignoreCaseGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x0069 (LATIN SMALL LETTER I).
  const cu = 'i';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

/** https://tc39.es/ecma262/#sec-regexp.prototype-@@match */
function* RegExpProto_match([string = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let rx be the this value.
  const rx = thisValue;
  // 2. If Type(rx) is not Object, throw a TypeError exception.
  if (!(rx instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', rx, 'RegExp');
  }
  // 3. Let S be ? ToString(string).
  const S = Q(yield* ToString(string));
  // 4. Let flags be ? ToString(? Get(rx, "flags")).
  const flags = Q(yield* ToString(Q(yield* Get(rx, 'flags'))));
  // 5. If flags does not contain "g", then
  if (!flags.includes('g')) {
    // a. Return ? RegExpExec(rx, S).
    return Q(yield* RegExpExec(rx, S));
  } else { // 6. Else,
    // a. If flags contains "u", let fullUnicode be true. Otherwise, let fullUnicode be false.
    const fullUnicode = flags.includes('u');
    // b. Perform ? Set(rx, "lastIndex", +0𝔽, true).
    Q(yield* Set(rx, 'lastIndex', F(+0), true));
    // c. Let A be ! ArrayCreate(0).
    const A = X(ArrayCreate(0));
    // d. Let n be 0.
    let n = 0;
    // e. Repeat,
    while (true) {
      // i. Let result be ? RegExpExec(rx, S).
      const result = Q(yield* RegExpExec(rx, S));
      // ii. If result is null, then
      if (result instanceof NullValue) {
        // 1. If n = 0, return null.
        if (n === 0) {
          return Value.null;
        }
        // 2. Return A.
        return A;
      } else { // iii. Else,
        // 1. Let matchStr be ? ToString(? Get(result, "0")).
        const matchStr = Q(yield* ToString(Q(yield* Get(result, '0'))));
        // 2. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), matchStr).
        X(CreateDataPropertyOrThrow(A, X(ToString(F(n))), Value(matchStr)));
        // 3. If matchStr is the empty String, then
        if (matchStr === '') {
          // a. Let thisIndex be ℝ(? ToLength(? Get(rx, "lastIndex"))).
          const thisIndex = R(Q(yield* ToLength(Q(yield* Get(rx, 'lastIndex')))));
          // b. Let nextIndex be AdvanceStringIndex(S, thisIndex, fullUnicode).
          const nextIndex = AdvanceStringIndex(S, thisIndex, fullUnicode);
          // c. Perform ? Set(rx, "lastIndex", 𝔽(nextIndex), true).
          Q(yield* Set(rx, 'lastIndex', F(nextIndex), true));
        }
        // 4. Set n to n + 1.
        n += 1;
      }
    }
  }
}

/** https://tc39.es/ecma262/#sec-regexp-prototype-matchall */
function* RegExpProto_matchAll([string = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const R = thisValue;
  if (!(R instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  const S = Q(yield* ToString(string));
  const C = Q(yield* SpeciesConstructor(R, surroundingAgent.intrinsic('%RegExp%')));
  const flags = Q(yield* ToString(Q(yield* Get(R, 'flags'))));
  const matcher = Q(yield* Construct(C, [R, Value(flags)]));
  const lastIndex = Q(yield* ToLength(Q(yield* Get(R, 'lastIndex'))));
  Q(yield* Set(matcher, 'lastIndex', lastIndex, true));
  const global = flags.includes('g');
  const fullUnicode = flags.includes('u') || flags.includes('v');
  return CreateRegExpStringIterator(matcher, S, global, fullUnicode);
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.multiline */
function RegExpProto_multilineGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x006D (LATIN SMALL LETTER M).
  const cu = 'm';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

/** https://tc39.es/ecma262/#sec-regexp.prototype-@@replace */
function* RegExpProto_replace([string = Value.undefined, replaceValue = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let rx be the this value.
  const rx = thisValue;
  // 2. If rx is not an Object, throw a TypeError exception.
  if (!(rx instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', rx, 'RegExp');
  }
  // 3. Let S be ? ToString(string).
  const S = Q(yield* ToString(string));
  // 4. Let lengthS be the length of S.
  const lengthS = S.length;
  // 5. Let functionalReplace be IsCallable(replaceValue).
  const functionalReplace = IsCallable(replaceValue);
  // 6. If functionalReplace is false, then
  if (!functionalReplace) {
    // a. Set replaceValue to ? ToString(replaceValue).
    replaceValue = Value(Q(yield* ToString(replaceValue)));
  }
  // 7. Let flags be ? ToString(? Get(rx, "flags")).
  const flags = Q(yield* ToString(Q(yield* Get(rx, 'flags'))));
  // 8. If flags contains "g", let global be true. Otherwise, let global be false.
  const global = flags.includes('g') ? Value.true : Value.false;
  let fullUnicode;
  // 9. If global is true, then
  if (global === Value.true) {
    // a. If flags contains "u", let fullUnicode be true. Otherwise, let fullUnicode be false.
    fullUnicode = flags.includes('u');
    // b. Perform ? Set(rx, "lastIndex", +0𝔽, true).
    Q(yield* Set(rx, 'lastIndex', F(+0), true));
  }
  // 10. Let results be a new empty List.
  const results = [];
  // 11. Let done be false.
  let done = false;
  // 12. Repeat, while done is false,
  while (!done) {
    // a. Let result be ? RegExpExec(rx, S).
    const result = Q(yield* RegExpExec(rx, S));
    // b. If result is null, set done to true.
    if (result instanceof NullValue) {
      done = true;
    } else { // c. Else,
      // i. Append result to results.
      results.push(result);
      // ii. If global is false, set done to true.
      if (global === Value.false) {
        done = true;
      } else { // iii. Else,
        // 1. Let matchStr be ? ToString(? Get(result, "0")).
        const matchStr = Q(yield* ToString(Q(yield* Get(result, '0'))));
        // 2. If matchStr is the empty String, then
        if (matchStr === '') {
          // a. Let thisIndex be ℝ(? ToLength(? Get(rx, "lastIndex"))).
          const thisIndex = R(Q(yield* ToLength(Q(yield* Get(rx, 'lastIndex')))));
          // b. Let nextIndex be AdvanceStringIndex(S, thisIndex, fullUnicode).
          const nextIndex = AdvanceStringIndex(S, thisIndex, fullUnicode!);
          // c. Perform ? Set(rx, "lastIndex", 𝔽(nextIndex), true).
          Q(yield* Set(rx, 'lastIndex', F(nextIndex), true));
        }
      }
    }
  }
  // 13. Let accumulatedResult be the empty String.
  let accumulatedResult = '';
  // 14. Let nextSourcePosition be 0.
  let nextSourcePosition = 0;
  // 15. For each element result of results, do
  for (const result of results) {
    // a. Let resultLength be ? LengthOfArrayLike(result).
    let nCaptures = Q(yield* LengthOfArrayLike(result));
    // b. Let nCaptures be max(resultLength - 1, 0).
    nCaptures = Math.max(nCaptures - 1, 0);
    // c. Let matched be ? ToString(? Get(result, "0")).
    const matched = Q(yield* ToString(Q(yield* Get(result, '0'))));
    // d. Let matchLength be the length of matched.
    const matchLength = matched.length;
    // e. Let position be ? ToIntegerOrInfinity(? Get(result, "index")).
    let position = Q(yield* ToIntegerOrInfinity(Q(yield* Get(result, 'index'))));
    // f. Set position to the result of clamping position between 0 and lengthS.
    position = Math.max(Math.min(position, lengthS), 0);
    // g. Let captures be a new empty List.
    const captures: (string | undefined)[] = [];
    // h. Let n be 1.
    let n = 1;
    // i. Repeat, while n ≤ nCaptures,
    while (n <= nCaptures) {
      // i. Let capN be ? Get(result, ! ToString(𝔽(n))).
      let capN: Value | string = Q(yield* Get(result, X(ToString(F(n)))));
      // ii. If capN is not undefined, then
      if (capN !== Value.undefined) {
        // 1. Set capN to ? ToString(capN).
        capN = Q(yield* ToString(capN));
      }
      // iii. Append capN to captures.
      captures.push(capN instanceof UndefinedValue ? undefined : capN);
      // iv. NOTE: When n = 1, the preceding step puts the first element into captures
      //     (at index 0). More generally, the nth capture (the characters captured by
      //     the nth set of capturing parentheses) is at captures[n - 1].
      // v. Set n to n + 1.
      n += 1;
    }
    // j. Let namedCaptures be ? Get(result, "groups").
    let namedCaptures = Q(yield* Get(result, 'groups'));
    let replacement;
    // k. If functionalReplace is true, then
    if (functionalReplace) {
      // i. Let replacerArgs be the list-concatenation of « matched », captures, and « 𝔽(position), S ».
      const replacerArgs: Value[] = [Value(matched), ...captures.map(Value), F(position), Value(S)];
      // ii. If namedCaptures is not undefined, then
      if (namedCaptures !== Value.undefined) {
        // 1. Append namedCaptures to replacerArgs.
        replacerArgs.push(namedCaptures);
      }
      // iii. Let replValue be ? Call(replaceValue, undefined, replacerArgs).
      const replValue = Q(yield* Call(replaceValue, Value.undefined, replacerArgs));
      // iv. Let replacement be ? ToString(replValue).
      replacement = Q(yield* ToString(replValue));
    } else { // l. Else,
      // i. If namedCaptures is not undefined, then
      if (namedCaptures !== Value.undefined) {
        // 1. Set namedCaptures to ? ToObject(namedCaptures).
        namedCaptures = Q(ToObject(namedCaptures));
      }
      // ii. Let replacement be ? GetSubstitution(matched, S, position, captures, namedCaptures, replaceValue).
      replacement = Q(yield* GetSubstitution(matched, S, position, captures, namedCaptures, (replaceValue as JSStringValue).stringValue()));
    }
    // m. If position ≥ nextSourcePosition, then
    if (position >= nextSourcePosition) {
      // i. NOTE: position should not normally move backwards. If it does, it is an indication of an
      //          ill-behaving RegExp subclass or use of an access triggered side-effect to change the
      //          global flag or other characteristics of rx. In such cases, the corresponding substitution is ignored.
      // ii. Set accumulatedResult to the string-concatenation of accumulatedResult, the substring of S from nextSourcePosition to position, and replacement.
      accumulatedResult = accumulatedResult + S.substring(nextSourcePosition, position) + replacement;
      // iii. Set nextSourcePosition to position + matchLength.
      nextSourcePosition = position + matchLength;
    }
  }
  // 16. If nextSourcePosition ≥ lengthS, return accumulatedResult.
  if (nextSourcePosition >= lengthS) {
    return Value(accumulatedResult);
  }
  // 17. Return the string-concatenation of accumulatedResult and the substring of S from nextSourcePosition.
  return Value(accumulatedResult + S.substring(nextSourcePosition));
}

/** https://tc39.es/ecma262/#sec-regexp.prototype-@@search */
function* RegExpProto_search([string = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const rx = thisValue;
  if (!(rx instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', rx, 'RegExp');
  }
  const S = Q(yield* ToString(string));

  const previousLastIndex = Q(yield* Get(rx, 'lastIndex'));
  if (!SameValue(previousLastIndex, F(+0))) {
    Q(yield* Set(rx, 'lastIndex', F(+0), true));
  }

  const result = Q(yield* RegExpExec(rx, S));
  const currentLastIndex = Q(yield* Get(rx, 'lastIndex'));
  if (!SameValue(currentLastIndex, previousLastIndex)) {
    Q(yield* Set(rx, 'lastIndex', previousLastIndex, true));
  }

  if (result instanceof NullValue) {
    return F(-1);
  }

  return Q(yield* Get(result, 'index'));
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.source */
function RegExpProto_sourceGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const R = thisValue;
  if (!(R instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  if (!('OriginalSource' in R)) {
    if (SameValue(R, surroundingAgent.intrinsic('%RegExp.prototype%'))) {
      return Value('(?:)');
    }
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  Assert(isRegExpObject(R));
  const src = R.OriginalSource;
  const flags = R.OriginalFlags;
  return Value(EscapeRegExpPattern(src, flags));
}

/** https://tc39.es/ecma262/#sec-regexp.prototype-@@split */
function* RegExpProto_split([string = Value.undefined, limit = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const rx = thisValue;
  if (!(rx instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', rx, 'RegExp');
  }
  const S = Q(yield* ToString(string));

  const C = Q(yield* SpeciesConstructor(rx, surroundingAgent.intrinsic('%RegExp%')));
  const flagsValue = Q(yield* Get(rx, 'flags'));
  const flags = Q(yield* ToString(flagsValue));
  const unicodeMatching = flags.includes('u');
  const newFlags = flags.includes('y') ? Value(flags) : Value(`${flags}y`);
  const splitter = Q(yield* Construct(C, [rx, newFlags]));

  const A = X(ArrayCreate(0));
  let lengthA = 0;

  let lim;
  if (limit === Value.undefined) {
    lim = (2 ** 32) - 1;
  } else {
    lim = R(Q(yield* ToUint32(limit)));
  }

  const size = S.length;
  let p = 0;

  if (lim === 0) {
    return A;
  }

  if (size === 0) {
    const z = Q(yield* RegExpExec(splitter, S));
    if (z !== Value.null) {
      return A;
    }
    X(CreateDataProperty(A, '0', Value(S)));
    return A;
  }

  let q = p;
  while (q < size) {
    Q(yield* Set(splitter, 'lastIndex', F(q), true));
    const z = Q(yield* RegExpExec(splitter, S));
    if (z instanceof NullValue) {
      q = AdvanceStringIndex(S, q, unicodeMatching);
    } else {
      const lastIndex = Q(yield* Get(splitter, 'lastIndex'));
      let e = R(Q(yield* ToLength(lastIndex)));
      e = Math.min(e, size);
      if (e === p) {
        q = AdvanceStringIndex(S, q, unicodeMatching);
      } else {
        const T = Value(S.substring(p, q));
        X(CreateDataProperty(A, X(ToString(F(lengthA))), T));
        lengthA += 1;
        if (lengthA === lim) {
          return A;
        }
        p = e;
        let numberOfCaptures = Q(yield* LengthOfArrayLike(z));
        numberOfCaptures = Math.max(numberOfCaptures - 1, 0);
        let i = 1;
        while (i <= numberOfCaptures) {
          const nextCapture = Q(yield* Get(z, X(ToString(F(i)))));
          X(CreateDataProperty(A, X(ToString(F(lengthA))), nextCapture));
          i += 1;
          lengthA += 1;
          if (lengthA === lim) {
            return A;
          }
        }
        q = p;
      }
    }
  }

  const T = Value(S.substring(p, size));
  X(CreateDataProperty(A, X(ToString(F(lengthA))), T));
  return A;
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.sticky */
function RegExpProto_stickyGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x0097 (LATIN SMALL LETTER Y).
  const cu = 'y';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

/** https://tc39.es/ecma262/#sec-regexp.prototype.test */
function* RegExpProto_test([S = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const R = thisValue;
  if (!(R instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  const string = Q(yield* ToString(S));
  const match = Q(yield* RegExpExec(R, string));
  if (match !== Value.null) {
    return Value.true;
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-regexp.prototype.tostring */
function* RegExpProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const R = thisValue;
  if (!(R instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not a $2 object', R, 'RegExp');
  }
  const pattern = Q(yield* ToString(Q(yield* Get(R, 'source'))));
  const flags = Q(yield* ToString(Q(yield* Get(R, 'flags'))));
  const result = `/${pattern}/${flags}`;
  return Value(result);
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.unicode */
function RegExpProto_unicodeGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x0075 (LATIN SMALL LETTER U).
  const cu = 'u';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

/** https://tc39.es/ecma262/#sec-get-regexp.prototype.unicodeSets */
function RegExpProto_unicodeSetsGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let R be the this value.
  const R = thisValue;
  // 2. Let cu be the code unit 0x0076 (LATIN SMALL LETTER V).
  const cu = 'v';
  // 3. Return ? RegExpHasFlag(R, cu).
  return Value(Q(RegExpHasFlag(R, cu)));
}

export function bootstrapRegExpPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(
    realmRec,
    [
      ['exec', RegExpProto_exec, 1],
      ['dotAll', [RegExpProto_dotAllGetter]],
      ['flags', [RegExpProto_flagsGetter]],
      ['global', [RegExpProto_globalGetter]],
      ['hasIndices', [RegExpProto_hasIndicesGetter]],
      ['ignoreCase', [RegExpProto_ignoreCaseGetter]],
      [wellKnownSymbols.match, RegExpProto_match, 1],
      [wellKnownSymbols.matchAll, RegExpProto_matchAll, 1],
      ['multiline', [RegExpProto_multilineGetter]],
      [wellKnownSymbols.replace, RegExpProto_replace, 2],
      [wellKnownSymbols.search, RegExpProto_search, 1],
      ['source', [RegExpProto_sourceGetter]],
      [wellKnownSymbols.split, RegExpProto_split, 2],
      ['sticky', [RegExpProto_stickyGetter]],
      ['test', RegExpProto_test, 1],
      ['toString', RegExpProto_toString, 0],
      ['unicode', [RegExpProto_unicodeGetter]],
      ['unicodeSets', [RegExpProto_unicodeSetsGetter]],
    ],
    realmRec.Intrinsics['%Object.prototype%'],
  );

  realmRec.Intrinsics['%RegExp.prototype%'] = proto;
}
