import {
  JSStringValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  isDecimalDigit, isLineTerminator, isWhitespace,
} from '../parser/Lexer.mts';
import { isAsciiLetter, isControlEscape, isSyntaxCharacter } from '../parser/RegExpParser.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { UnicodeEscape } from './JSON.mts';
import {
  surroundingAgent,
} from '#self';
import {
  Get,
  IsRegExp,
  Realm,
  RegExpAlloc,
  RegExpInitialize,
  SameValue,
  type FunctionObject,
  type OrdinaryObject,

  Assert, isLeadingSurrogate, isTrailingSurrogate, StringToCodePoints, UTF16EncodeCodePoint, type CodePoint, type RegExpMatcher, type RegExpRecord,
  Throw,
} from '#self';

export interface RegExpObject extends OrdinaryObject {
  readonly OriginalSource: string;
  readonly OriginalFlags: string;
  readonly RegExpMatcher: RegExpMatcher;
  readonly RegExpRecord: RegExpRecord;
  readonly parsedPattern: ParseNode.RegExp.Pattern;
}
export function isRegExpObject(o: Value): o is RegExpObject {
  return 'RegExpMatcher' in o;
}
/** https://tc39.es/ecma262/#sec-regexp-constructor */
function* RegExpConstructor([pattern = Value.undefined, flags = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  // 1. Let patternIsRegExp be ? IsRegExp(pattern).
  const patternIsRegExp = Q(yield* IsRegExp(pattern));
  let newTarget;
  // 2. If NewTarget is undefined, then
  if (NewTarget === Value.undefined) {
    // a. Let newTarget be the active function object.
    newTarget = surroundingAgent.activeFunctionObject;
    // b. If patternIsRegExp is true and flags is undefined, then
    if (patternIsRegExp && flags === Value.undefined) {
      // i. Let patternConstructor be ? Get(pattern, "constructor").
      const patternConstructor = Q(yield* Get(pattern as ObjectValue, 'constructor'));
      // ii. If SameValue(newTarget, patternConstructor) is true, return pattern.
      if (SameValue(newTarget, patternConstructor)) {
        return pattern;
      }
    }
  } else { // 3. Else, let newTarget be NewTarget.
    newTarget = NewTarget;
  }
  let P: string | Value;
  let F: string | Value;
  // 4. If Type(pattern) is Object and pattern has a [[RegExpMatcher]] internal slot, then
  if (isRegExpObject(pattern)) {
    // a. Let P be pattern.[[OriginalSource]].
    P = Value(pattern.OriginalSource);
    // b. If flags is undefined, let F be pattern.[[OriginalFlags]].
    if (flags === Value.undefined) {
      F = pattern.OriginalFlags;
    } else { // c. Else, let F be flags.
      F = flags;
    }
  } else if (patternIsRegExp) { // 5. Else if patternIsRegExp is true, then
    // a. Else if patternIsRegExp is true, then
    P = Q(yield* Get(pattern as ObjectValue, 'source'));
    // b. If flags is undefined, then
    if (flags === Value.undefined) {
      // i. Let F be ? Get(pattern, "flags").
    F = Q(yield* Get(pattern as ObjectValue, 'flags'));
    } else { // c. Else, let F be flags.
      F = flags;
    }
  } else { // 6. Else,
    // a. Let P be pattern.
    P = pattern;
    // b. Let F be flags.
    F = flags;
  }
  // 7. Let O be ? RegExpAlloc(newTarget).
  const O = Q(yield* RegExpAlloc(newTarget as FunctionObject));
  // 8. Return ? RegExpInitialize(O, P, F).
  return Q(yield* RegExpInitialize(O, P, F));
}

/** https://tc39.es/ecma262/#sec-regexp.escape */
function* RegExp_escape([S = Value.undefined]: Arguments) {
  if (!(S instanceof JSStringValue)) {
    return Throw.TypeError('$1 is not a string', S);
  }
  let escaped = '';
  const cpList = StringToCodePoints(S.stringValue());
  for (const cp of cpList) {
    if (escaped === '' && (isDecimalDigit(String.fromCodePoint(cp)) || isAsciiLetter(cp))) {
      const numericValue = cp;
      const hex = numericValue.toString(16);
      Assert(hex.length === 2);
      escaped += `\u{005C}x${hex}`;
    } else {
      escaped += EncodeForRegExpEscape(cp);
    }
  }
  return Value(escaped);
}

const table67: Record<number, string> = {
  9: 't',
  10: 'n',
  11: 'v',
  12: 'f',
  13: 'r',
};
function EncodeForRegExpEscape(cp: CodePoint) {
  const ch = String.fromCharCode(cp);
  if (cp === 0x002F || isSyntaxCharacter(ch)) {
    return `\u{005C}${UTF16EncodeCodePoint(cp)}`;
  } else if (isControlEscape(cp)) {
    return `\u{005C}${table67[cp]!}`;
  }
  const otherPunctuators = ",-=<>#&!%:;@~'`\u{0022}";
  const toEscape = StringToCodePoints(otherPunctuators);
  if (toEscape.includes(cp) || isWhitespace(ch) || isLineTerminator(ch) || isLeadingSurrogate(cp) || isTrailingSurrogate(cp)) {
    const cpNum = cp;
    if (cpNum <= 0xFF) {
      const hex = cpNum.toString(16);
      return `\u{005C}x${hex.padStart(2, '0')}`;
    }
    let escaped = '';
    const codeUnits = UTF16EncodeCodePoint(cp);
    for (const cu of codeUnits) {
      escaped += UnicodeEscape(cu);
    }
    return escaped;
  }
  return UTF16EncodeCodePoint(cp);
}

/** https://tc39.es/ecma262/#sec-get-regexp-@@species */
function RegExp_speciesGetter(_args: Arguments, { thisValue }: FunctionCallContext) {
  return thisValue;
}

export function bootstrapRegExp(realmRec: Realm) {
  const proto = realmRec.Intrinsics['%RegExp.prototype%'];

  const cons = bootstrapConstructor(realmRec, RegExpConstructor, 'RegExp', 2, proto, [
    [wellKnownSymbols.species, [RegExp_speciesGetter]],
    ['escape', RegExp_escape, 1],
  ]);

  realmRec.Intrinsics['%RegExp%'] = cons;
}
