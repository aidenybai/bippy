/* eslint-disable prefer-arrow-callback */
// use function name for better debug

/* https://tc39.es/ecma262/#sec-pattern */
import { CharacterValue, CodePointsToString } from '../static-semantics/all.mts';
import { isLineTerminator, isWhitespace } from '../parser/Lexer.mts';
import {
  __ts_cast__, isArray, OutOfRange, type Mutable,
} from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
// @ts-ignore
import PropertyValueAliases from '../unicode/PropertyValueAliases.json' with { type: 'json' };
import {
  Table70_BinaryUnicodeProperties,
  Table69_NonbinaryUnicodeProperties,
  Table71_BinaryPropertyOfStrings,
  Unicode,
  type Character,
  type ListOfCharacter,
  type CodePoint,
  type Table69_NonbinaryUnicodePropertiesCanonicalized,
} from './all.mts';
import { Assert } from '#self';

enum Direction {
  Forward = 1,
  Backward = -1,
}

export type RegExpMatchingSource = (readonly string[]) & { readonly raw: string };
/** https://tc39.es/ecma262/#pattern-matchstate */
class MatchState {
  readonly input: RegExpMatchingSource;

  readonly endIndex: number;

  readonly captures;

  constructor(input: RegExpMatchingSource, endIndex: number, captures: readonly (undefined | Range)[]) {
    this.input = input;
    this.endIndex = endIndex;
    this.captures = captures;
  }

  static createRegExpMatchingSource(input: readonly string[], raw: string) {
    (input as Mutable<RegExpMatchingSource>).raw = raw;
    return input as RegExpMatchingSource;
  }
}
export { MatchState as RegExpState };

export type MatcherResult = MatchState | 'failure';
export type RegExpMatcher = (input: RegExpMatchingSource, index: number) => MatcherResult;

// Note: A strict spec implementation cannot pass test262 because of stack overflow. We use generator to lift all calls to the top level.
type NonSpecFlattenedRegExpMatchingProcess = Generator<() => NonSpecFlattenedRegExpMatchingProcess, MatcherResult, MatcherResult>;
function runMatcher(matcher: NonSpecFlattenedRegExpMatchingProcess): MatcherResult {
  // when debug, uncomment to use this version might be easier.

  // if (1 + 1 === 2) {
  //   let next: MatcherResult;
  //   while (true) {
  //     const iter = iterator.next(next!);
  //     if (iter.done) {
  //       const ret = iter.value;
  //       return ret;
  //     }
  //     const nextCall = iter.value();
  //     const callResult = runMatcher(nextCall);
  //     next = callResult;
  //   }
  // }

  const stack: NonSpecFlattenedRegExpMatchingProcess[] = [];
  let next: MatcherResult | undefined;
  while (true) {
    const iter = matcher.next(next!);
    if (iter.done) {
      const ret = iter.value;
      // return ret;
      matcher = stack.pop()!;
      if (matcher) {
        // next = callResult (of upper call)
        next = ret;
        continue;
      } else {
        // outmost call
        return ret;
      }
    }
    const nextCall = iter.value();
    // const callResult = runMatcher(nextCall);
    stack.push(matcher);
    matcher = nextCall;
    next = undefined;
  }
}
/** https://tc39.es/ecma262/#pattern-matcher */
type Matcher = (x: MatchState, c: MatcherContinuation) => NonSpecFlattenedRegExpMatchingProcess;
/** https://tc39.es/ecma262/#pattern-matchercontinuation */
type MatcherContinuation = (y: MatchState) => NonSpecFlattenedRegExpMatchingProcess;

type CharTester = (char: Character, canonicalize: RegExpRecord | undefined) => boolean;
/** https://tc39.es/ecma262/#pattern-charset */
abstract class CharSet {
  abstract has(c: Character, rer: RegExpRecord | undefined): boolean;

  abstract hasList(c: ListOfCharacter): boolean;

  getStrings() {
    return [...this.strings || []];
  }

  /**
   * Return false if the Pattern is compiled in UnicodeSetMode and contains the empty sequence or sequences of more than one character.
   */
  abstract characterModeOnly: boolean;

  declare protected chars: Set<Character> | undefined;

  declare protected strings: Set<ListOfCharacter> | undefined;

  declare protected charTester: CharTester[] | undefined;

  static union(...sets: CharSet[]) {
    const unionChars = new Set<Character>();
    const unionStrings = new Set<ListOfCharacter>();
    let unionCharTesters: CharTester[] = [];
    sets.forEach((set) => {
      if (set.chars) {
        set.chars.forEach((c) => unionChars.add(c));
      }
      if (set.strings) {
        set.strings.forEach((s) => unionStrings.add(s));
      }
      if (set.charTester) {
        unionCharTesters = unionCharTesters.concat(set.charTester);
      }
    });

    if (!unionCharTesters.length) {
      if (!unionStrings.size) {
        return new ConcreteCharSet(unionChars);
      }
      if (!unionChars.size) {
        return ConcreteStringSet.of(unionStrings);
      }
    }
    if (!unionChars.size && !unionStrings.size && unionCharTesters.length === 1) {
      return new VirtualCharSet(unionCharTesters[0]);
    }
    return new UnionCharSet(unionChars, unionStrings, unionCharTesters);
  }

  static intersection(...sets: CharSet[]): CharSet {
    let intersectionChars: Set<Character>;
    const setChars = sets.filter((x) => x.chars);
    if (setChars.length === 0) {
      intersectionChars = new Set<Character>();
    } else if (setChars.length === 1) {
      intersectionChars = setChars[0].chars!;
    } else {
      const smallestSet = setChars.reduce((a, b) => (a.chars!.size < b.chars!.size ? a : b));
      intersectionChars = new Set();
      smallestSet.chars!.forEach((c) => {
        if (setChars.every((s) => s.chars!.has(c))) {
          intersectionChars.add(c);
        }
      });
    }

    let intersectionStrings: Set<ListOfCharacter>;
    const setStrings = sets.filter((x) => x.strings);
    if (setStrings.length === 0) {
      intersectionStrings = new Set<ListOfCharacter>();
    } else if (setStrings.length === 1) {
      intersectionStrings = setStrings[0].strings!;
    } else {
      const smallestSet = setStrings.reduce((a, b) => (a.strings!.size < b.strings!.size ? a : b));
      intersectionStrings = new Set();
      smallestSet.strings!.forEach((s) => {
        if (setStrings.every((c) => c.strings!.has(s))) {
          intersectionStrings.add(s);
        }
      });
    }

    let allCharTesters: CharTester[] = [];
    sets.forEach((set) => {
      if (set.charTester) {
        allCharTesters = allCharTesters.concat(set.charTester);
      }
    });

    if (!allCharTesters.length) {
      if (!intersectionStrings.size) {
        return new ConcreteCharSet(intersectionChars);
      }
      if (!intersectionChars.size) {
        return ConcreteStringSet.of(intersectionStrings);
      }
      return new UnionCharSet(intersectionChars, intersectionStrings, undefined);
    }
    return new UnionCharSet(intersectionChars, intersectionStrings, allCharTesters.length ? [(char, canonicalize) => allCharTesters.every((f) => f(char, canonicalize))] : undefined);
  }

  static subtract(maxSet: CharSet, subtractAllStrings: boolean, ...subtracts: readonly CharSet[]): CharSet {
    const maxChars = maxSet.chars;
    const maxStrings = subtractAllStrings ? undefined : maxSet.strings;
    let allSubtractCharTesters: CharTester[] = [];
    subtracts.forEach((subtract) => {
      if (maxChars) {
        subtract.chars?.forEach((c) => maxChars.delete(c));
      }
      if (maxStrings) {
        subtract.strings?.forEach((s) => maxStrings.delete(s));
      }
      if (subtract.charTester) {
        allSubtractCharTesters = allSubtractCharTesters.concat(subtract.charTester);
      }
    });
    if (!maxSet.charTester?.length && !allSubtractCharTesters.length) {
      if (!maxStrings?.size) {
        return new ConcreteCharSet(maxChars || []);
      }
      if (!maxChars?.size) {
        return ConcreteStringSet.of(maxStrings);
      }
      return new UnionCharSet(maxChars, maxStrings, undefined);
    }
    return new UnionCharSet(
      undefined,
      maxStrings,
      [(char, canonicalize) => {
        if (!(maxChars?.has(char) || maxSet.charTester?.some((f) => f(char, canonicalize)))) {
          return false;
        }
        if (allSubtractCharTesters.some((f) => f(char, canonicalize))) {
          return false;
        }
        return true;
      }],
    );
  }
}

class VirtualCharSet extends CharSet {
  #f: CharTester;

  protected override charTester;

  constructor(f: CharTester) {
    super();
    this.#f = f;
    this.charTester = [f];
  }

  override has(c: Character, rer: RegExpRecord | undefined): boolean {
    return this.#f(c, rer);
  }

  override hasList(_c: ListOfCharacter): boolean {
    return false;
  }

  override characterModeOnly = true;
}

class ConcreteCharSet extends CharSet {
  protected override chars;

  #canonicalize: Record<string, Set<Character>> | undefined;

  protected get debuggerGetCodePoints() {
    return [...this.chars].map((char) => Unicode.toCodePoint(char));
  }

  constructor(chars: Iterable<Character>) {
    super();
    this.chars = new Set(chars);
  }

  override has(c: Character, rer: RegExpRecord): boolean {
    const canonicalizeKey = JSON.stringify(rer);
    this.#canonicalize ??= {};
    if (!this.#canonicalize[canonicalizeKey]) {
      this.#canonicalize[canonicalizeKey] = new Set();
      const set = this.#canonicalize[canonicalizeKey];
      for (const c of this.chars) {
        const ch = Canonicalize(rer, c);
        set.add(ch);
      }
    }
    return this.#canonicalize[canonicalizeKey].has(c);
  }

  override hasList(_c: ListOfCharacter): boolean {
    return false;
  }

  override characterModeOnly = true;

  soleChar() {
    Assert(this.chars.size === 1);
    return this.chars.values().next().value!;
  }
}

class ConcreteStringSet extends CharSet {
  protected override strings;

  private constructor(strings: Iterable<ListOfCharacter>) {
    super();
    this.strings = new Set(strings);
  }

  static of(charOrStrings: Iterable<ListOfCharacter>): CharSet {
    const chars = new Set<Character>();
    const strings = new Set<ListOfCharacter>();
    for (const charOrString of charOrStrings) {
      if (charOrString.length <= 1 || (charOrString.length === 2 && Array.from(charOrString).length === 1)) {
        chars.add(charOrString as unknown as Character);
      } else {
        strings.add(charOrString);
      }
    }
    if (chars.size && !strings.size) {
      return new ConcreteCharSet(chars);
    } else if (strings.size && !chars.size) {
      return new ConcreteStringSet(strings);
    }
    return new UnionCharSet(chars, strings, undefined);
  }

  override has(_c: Character): boolean {
    return false;
  }

  override hasList(c: ListOfCharacter): boolean {
    return this.strings.has(c);
  }

  override characterModeOnly = false;
}

class UnionCharSet extends CharSet {
  constructor(chars: Set<Character> | undefined, strings: Set<ListOfCharacter> | undefined, charTesters: CharTester[] | undefined) {
    super();
    this.chars = chars;
    this.strings = strings;
    this.charTester = charTesters;
  }

  override has(c: Character, rer: RegExpRecord): boolean {
    if (this.chars && new ConcreteCharSet(this.chars).has(c, rer)) {
      return true;
    }
    if (this.charTester?.some((f) => f(c, rer))) {
      return true;
    }
    return false;
  }

  override hasList(c: ListOfCharacter): boolean {
    return !!this.strings?.has(c);
  }

  get characterModeOnly() {
    return !this.strings?.size;
  }
}

/** https://tc39.es/ecma262/#sec-regexp-records */
export interface RegExpRecord {
  readonly IgnoreCase: boolean;
  readonly Multiline: boolean;
  readonly DotAll: boolean;
  readonly Unicode: boolean;
  readonly UnicodeSets: boolean;
  readonly CapturingGroupsCount: number;
}

export interface Range {
  readonly startIndex: number;
  readonly endIndex: number;
}

/** https://tc39.es/ecma262/#sec-compilepattern */
export function CompilePattern(pattern: ParseNode.RegExp.Pattern, rer: RegExpRecord): RegExpMatcher {
  const m = CompileSubPattern(pattern.Disjunction, rer, Direction.Forward);
  annotateMatcher(m, pattern.Disjunction);
  return (input, index) => {
    Assert(index >= 0 && index <= input.length);
    const c: MatcherContinuation = function* MatchSuccess(y: MatchState) {
      return y;
    };
    // Let cap be a List of rer.[[CapturingGroupsCount]] undefined values, indexed 1 through rer.[[CapturingGroupsCount]].
    const cap = [];
    for (let index = 1; index <= rer.CapturingGroupsCount; index += 1) {
      cap[index] = undefined;
    }
    const x = new MatchState(input, index, cap);
    return runMatcher(m(x, c));
  };
}

/** https://tc39.es/ecma262/#sec-compilesubpattern */
function CompileSubPattern(
  node:
  ParseNode.RegExp.Disjunction | ParseNode.RegExp.Alternative | ParseNode.RegExp.Term,
  rer: RegExpRecord,
  direction: Direction,
): Matcher {
  switch (node.type) {
    //  Disjunction :: Alternative | Disjunction
    case 'Disjunction': {
      if (node.Alternative && node.Disjunction) {
        const m1 = CompileSubPattern(node.Alternative, rer, direction);
        const m2 = CompileSubPattern(node.Disjunction, rer, direction);
        return MatchTwoAlternatives(m1, m2);
      }
      // Disjunction :: Alternative
      return CompileSubPattern(node.Alternative, rer, direction);
    }
    // Alternative :: [empty]
    // Alternative :: Alternative Term
    case 'Alternative': {
      if (!node.Term.length) {
        return EmptyMatcher;
      }
      if (node.Term.length === 1) {
        return CompileSubPattern(node.Term[0], rer, direction);
      }
      return node.Term.reduceRight<Matcher>((m2, term) => {
        const m1 = CompileSubPattern(term, rer, direction);
        if (!m2) {
          return m1;
        }
        return MatchSequence(m1, m2, direction);
      }, undefined!);
    }
    // Term :: Assertion
    // Term :: Atom
    // Term :: Atom Quantifier
    case 'Term': {
      switch (node.production) {
        case 'Assertion':
          return annotateMatcher(CompileAssertion(node.Assertion, rer), node.Assertion);
        case 'Atom':
          if (node.Quantifier) {
            const m = CompileAtom(node.Atom, rer, direction);
            const q = CompileQuantifier(node.Quantifier);
            Assert(q.Min <= q.Max);
            const parenIndex = CountLeftCapturingParensBefore(node);
            const parenCount = CountLeftCapturingParensWithin(node);
            return (x, c) => RepeatMatcher(m, q.Min, q.Max, q.Greedy, x, c, parenIndex, parenCount);
          } else {
            return CompileAtom(node.Atom, rer, direction);
          }
        default:
          throw OutOfRange.exhaustive(node);
      }
    }
    default:
  }
  throw OutOfRange.exhaustive(node);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-repeatmatcher-abstract-operation */
function* RepeatMatcher(m: Matcher, min: number, max: number, greedy: boolean, x: MatchState, c: MatcherContinuation, parenIndex: number, parenCount: number): NonSpecFlattenedRegExpMatchingProcess {
  if (max === 0) {
    return yield () => c(x);
  }
  const d: MatcherContinuation = function* RepeatMatcher_d(y) {
    if (min === 0 && y.endIndex === x.endIndex) {
      return 'failure';
    }
    const min2 = min === 0 ? 0 : min - 1;
    const max2 = max === Infinity ? Infinity : max - 1;
    return yield () => RepeatMatcher(m, min2, max2, greedy, y, c, parenIndex, parenCount);
  };
  const cap = [...x.captures];
  for (let k = parenIndex + 1; k <= parenIndex + parenCount; k += 1) {
    cap[k] = undefined;
  }
  const input = x.input;
  const e = x.endIndex;
  const xr = new MatchState(input, e, cap);
  if (min !== 0) {
    return yield () => m(xr, d);
  }
  if (!greedy) {
    const z = yield () => c(x);
    if (z !== 'failure') {
      return z;
    }
    return yield () => m(xr, d);
  }
  const z = yield () => m(xr, d);
  if (z !== 'failure') {
    return z;
  }
  return yield () => c(x);
}

/** https://tc39.es/ecma262/#sec-emptymatcher */
const EmptyMatcher: Matcher = (x, c) => c(x);
annotateMatcher(EmptyMatcher, 'EmptyMatcher');

/** https://tc39.es/ecma262/#sec-matchtwoalternatives */
function MatchTwoAlternatives(m1: Matcher, m2: Matcher): Matcher {
  return annotateMatcher(function* TwoAlternatives(x, c) {
    const r = yield () => m1(x, c);
    if (r !== 'failure') {
      return r;
    }
    return yield () => m2(x, c);
  }, [(m1 as MatcherWithComment).comment || m1, '|', (m2 as MatcherWithComment).comment || m2]);
}

/** https://tc39.es/ecma262/#sec-matchsequence */
function MatchSequence(m1: Matcher, m2: Matcher, direction: Direction): Matcher {
  if (direction === Direction.Forward) {
    return annotateMatcher(function Seq(x, c) {
      const d: MatcherContinuation = (y) => m2(y, c);
      return m1(x, d);
    }, [(m1 as MatcherWithComment).comment || m1, '|', (m2 as MatcherWithComment).comment || m2]);
  } else {
    return annotateMatcher(function Seq_Backword(x, c) {
      const d: MatcherContinuation = (y) => m1(y, c);
      return m2(x, d);
    }, [(m2 as MatcherWithComment).comment || m2, '|', (m1 as MatcherWithComment).comment || m1]);
  }
}

/** https://tc39.es/ecma262/#sec-compileassertion */
function CompileAssertion(node: ParseNode.RegExp.Assertion, rer: RegExpRecord): Matcher {
  if (node.production === '^') {
    return function* Assertion_Start(x, c) {
      const Input = x.input;
      const e = x.endIndex;
      if (e === 0 || (rer.Multiline && isLineTerminator(Input[e - 1]))) {
        return yield () => c(x);
      }
      return 'failure';
    };
  } else if (node.production === '$') {
    return function* Assertion_End(x, c) {
      const Input = x.input;
      const e = x.endIndex;
      if (e === Input.length || (rer.Multiline && isLineTerminator(Input[e]))) {
        return yield () => c(x);
      }
      return 'failure';
    };
  } else if (node.production === 'b') {
    return function* Assertion_WordBoundary(x, c) {
      const Input = x.input;
      const e = x.endIndex;
      const a = IsWordChar(rer, Input.raw, e - 1);
      const b = IsWordChar(rer, Input.raw, e);
      if ((a && !b) || (!a && b)) {
        return yield () => c(x);
      }
      return 'failure';
    };
  } else if (node.production === 'B') {
    return function* Assertion_NotWordBoundary(x, c) {
      const Input = x.input;
      const e = x.endIndex;
      const a = IsWordChar(rer, Input.raw, e - 1);
      const b = IsWordChar(rer, Input.raw, e);
      if ((a && b) || (!a && !b)) {
        return yield () => c(x);
      }
      return 'failure';
    };
  } else if (node.production === 'A') {
    return function* Assertion_BufferStart(x, c) {
      const e = x.endIndex;
      if (e === 0) {
        return yield () => c(x);
      }
      return 'failure';
    };
  } else if (node.production === 'z') {
    return function* Assertion_BufferEnd(x, c) {
      const Input = x.input;
      const e = x.endIndex;
      if (e === Input.length) {
        return yield () => c(x);
      }
      return 'failure';
    };
  } else if (node.production === '?=') {
    const m = CompileSubPattern(node.Disjunction, rer, Direction.Forward);
    return function* Assertion_PositiveLookahead(x, c) {
      const d: MatcherContinuation = function* Assertion_PositiveLookahead_Success(y) {
        return y;
      };
      const r = yield () => m(x, d);
      if (r === 'failure') {
        return 'failure';
      }
      const cap = r.captures;
      const input = x.input;
      const xe = x.endIndex;
      const z = new MatchState(input, xe, cap);
      return yield () => c(z);
    };
  } else if (node.production === '?!') {
    const m = CompileSubPattern(node.Disjunction, rer, Direction.Forward);
    return function* Assertion_NegativeLookahead(x, c) {
      const d: MatcherContinuation = function* Assertion_NegativeLookahead_Success(y) {
        return y;
      };
      const r = yield () => m(x, d);
      if (r !== 'failure') {
        return 'failure';
      }
      return yield () => c(x);
    };
  } else if (node.production === '?<=') {
    const m = CompileSubPattern(node.Disjunction, rer, Direction.Backward);
    return function* Assertion_PositiveLookBehind(x, c) {
      const d: MatcherContinuation = function* Assertion_PositiveLookBehind_Success(y) {
        return y;
      };
      const r = yield () => m(x, d);
      if (r === 'failure') {
        return 'failure';
      }
      const cap = r.captures;
      const input = x.input;
      const xe = x.endIndex;
      const z = new MatchState(input, xe, cap);
      return yield () => c(z);
    };
  } else if (node.production === '?<!') {
    const m = CompileSubPattern(node.Disjunction, rer, Direction.Backward);
    return function* Assertion_NegativeLookBehind(x, c) {
      const d: MatcherContinuation = function* Assertion_NegativeLookBehind_Success(y) {
        return y;
      };
      const r = yield () => m(x, d);
      if (r !== 'failure') {
        return 'failure';
      }
      return yield () => c(x);
    };
  }
  throw OutOfRange.exhaustive(node.production);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-iswordchar-abstract-operation */
function IsWordChar(rer: RegExpRecord, Input: string, e: number): boolean {
  const inputLength = Input.length;
  if (e === -1 || e === inputLength) {
    return false;
  }
  const c = Input[e];
  return WordCharacters(rer).has(c as Character, rer);
}

/** https://tc39.es/ecma262/#sec-compilequantifier */
function CompileQuantifier(node: ParseNode.RegExp.Quantifier): { Min: number, Max: number, Greedy: boolean } {
  const [Min, Max] = CompileQuantifierPrefix(node.QuantifierPrefix);
  return { Min, Max, Greedy: !node.QuestionMark };
}

/** https://tc39.es/ecma262/#sec-compilequantifierprefix */
function CompileQuantifierPrefix(node: ParseNode.RegExp.Quantifier['QuantifierPrefix']): [Min: number, Max: number] {
  switch (node.production) {
    case '*':
      return [0, Infinity];
    case '+':
      return [1, Infinity];
    case '?':
      return [0, 1];
    default: {
      return [node.DecimalDigits_a, node.DecimalDigits_b || node.DecimalDigits_a];
    }
  }
}

/** https://tc39.es/ecma262/#sec-compileatom */
function CompileAtom(node: ParseNode.RegExp.Atom | ParseNode.RegExp.AtomEscape, rer: RegExpRecord, direction: Direction): Matcher {
  if (node.type === 'Atom') {
    switch (node.production) {
      // Atom :: PatternCharacter
      case 'PatternCharacter': {
        const ch = node.PatternCharacter;
        const A = new ConcreteCharSet([ch]);
        return CharacterSetMatcher(rer, A, false, direction);
      }
      // Atom :: .
      case '.': {
        let A: CharSet = AllCharacters(rer);
        if (!rer.DotAll) {
          // Remove from A all characters corresponding to a code point on the right-hand side of the LineTerminator production.
          A = CharSet.subtract(A, false, new VirtualCharSet(isLineTerminator));
        }
        return CharacterSetMatcher(rer, A, false, direction);
      }
      // Atom :: CharacterClass
      case 'CharacterClass': {
        const cc = CompileCharacterClass(node.CharacterClass, rer);
        const cs = cc.CharSet;
        // If rer.[[UnicodeSets]] is false, or if every CharSetElement of cs consists of a single character (including if cs is empty), return CharacterSetMatcher(rer, cs, cc.[[Invert]], direction).
        if (!rer.UnicodeSets || cs.characterModeOnly) {
          return CharacterSetMatcher(rer, cs, cc.Invert, direction);
        }
        Assert(!cc.Invert);
        const lm: Matcher[] = [];
        // For each CharSetElement s in cs containing more than 1 character, iterating in descending order of length, do
        for (const s of cs.getStrings().sort((a, b) => b.length - a.length)) {
          // Let cs2 be a one-element CharSet containing the last code point of s.
          const cs2 = new ConcreteCharSet([s.at(-1)! as Character]);
          let m2 = CharacterSetMatcher(rer, cs2, false, direction);
          // For each code point c1 in s, iterating backwards from its second-to-last code point, do
          for (const c1 of Unicode.iterateByCodePoint(s).reverse().slice(1)) {
            const cs1 = new ConcreteCharSet([c1 as unknown as Character]);
            const m1 = CharacterSetMatcher(rer, cs1, false, direction);
            m2 = MatchSequence(m1, m2, direction);
          }
          lm.push(m2);
        }
        // Let singles be the CharSet containing every CharSetElement of cs that consists of a single character.
        const singles = CharSet.subtract(cs, true);
        lm.push(CharacterSetMatcher(rer, singles, false, direction));
        // If cs contains the empty sequence of characters, append EmptyMatcher() to lm.
        if (cs.hasList('' as ListOfCharacter)) {
          lm.push(EmptyMatcher);
        }
        let m2 = lm.at(-1)!;
        // For each Matcher m1 of lm, iterating backwards from its second-to-last element, do
        for (const m1 of lm.toReversed().slice(1)) {
          m2 = MatchTwoAlternatives(m1, m2);
        }
        return m2;
      }
      case 'Group': {
        const m = CompileSubPattern(node.Disjunction, rer, direction);
        const parenIndex = CountLeftCapturingParensBefore(node);
        return annotateMatcher(function GroupMatcher(x, c) {
          const d: MatcherContinuation = (y) => {
            const cap = [...y.captures];
            const Input = x.input;
            const xe = x.endIndex;
            const ye = y.endIndex;
            let r: Range;
            if (direction === Direction.Forward) {
              Assert(xe <= ye);
              r = { startIndex: xe, endIndex: ye };
            } else {
              Assert(direction === Direction.Backward);
              Assert(ye <= xe);
              r = { startIndex: ye, endIndex: xe };
            }
            cap[parenIndex + 1] = r;
            const z = new MatchState(Input, ye, cap);
            return c(z);
          };
          return m(x, d);
        }, node);
      }
      case 'Modifier': {
        const addModifiers = node.AddModifiers;
        const removeModifiers = node.RemoveModifiers;
        const modifiedRer = UpdateModifiers(rer, addModifiers?.join('') || '', removeModifiers?.join('') || '');
        return CompileSubPattern(node.Disjunction, modifiedRer, direction);
      }
      case 'AtomEscape':
        return CompileAtom(node.AtomEscape, rer, direction);
      default:
        throw OutOfRange.exhaustive(node);
    }
    // Atom :: ( GroupSpecifieropt Disjunction )
  } else if (node.type === 'AtomEscape') {
    switch (node.production) {
      case 'DecimalEscape': {
        const n = CapturingGroupNumber(node.DecimalEscape);
        Assert(n <= rer.CapturingGroupsCount);
        return BackreferenceMatcher(rer, [n], direction);
      }
      case 'CharacterEscape': {
        const cv = CharacterValue(node.CharacterEscape);
        const ch = Unicode.toCharacter(cv);
        const A = new ConcreteCharSet([ch]);
        return CharacterSetMatcher(rer, A, false, direction);
      }
      case 'CharacterClassEscape': {
        const cs = CompileToCharSet(node.CharacterClassEscape, rer);
        // If rer.[[UnicodeSets]] is false, or if every CharSetElement of cs consists of a single character (including if cs is empty), return CharacterSetMatcher(rer, cs, cc.[[Invert]], direction).
        if (!rer.UnicodeSets || cs.characterModeOnly) {
          return CharacterSetMatcher(rer, cs, false, direction);
        }
        const lm: Matcher[] = [];
        // For each CharSetElement s in cs containing more than 1 character, iterating in descending order of length, do
        for (const s of cs.getStrings().sort((a, b) => b.length - a.length)) {
          const codePointOfS = Unicode.iterateByCodePoint(s);
          // Let cs2 be a one-element CharSet containing the last code point of s.
          const cs2 = new ConcreteCharSet([codePointOfS.at(-1)!]);
          let m2 = CharacterSetMatcher(rer, cs2, false, direction);
          // For each code point c1 in s, iterating backwards from its second-to-last code point, do
          for (const c1 of codePointOfS.reverse().slice(1)) {
            const cs1 = new ConcreteCharSet([c1]);
            const m1 = CharacterSetMatcher(rer, cs1, false, direction);
            m2 = MatchSequence(m1, m2, direction);
          }
          lm.push(m2);
        }
        // Let singles be the CharSet containing every CharSetElement of cs that consists of a single character.
        const singles = CharSet.subtract(cs, true);
        lm.push(CharacterSetMatcher(rer, singles, false, direction));
        // If cs contains the empty sequence of characters, append EmptyMatcher() to lm.
        if (cs.hasList('' as ListOfCharacter)) {
          lm.push(EmptyMatcher);
        }
        let m2 = lm.at(-1)!;
        // For each Matcher m1 of lm, iterating backwards from its second-to-last element, do
        for (const m1 of lm.toReversed().slice(1)) {
          m2 = MatchTwoAlternatives(m1, m2);
        }
        return m2;
      }
      case 'CaptureGroupName': {
        const matchingGroupSpecifiers = GroupSpecifiersThatMatch(node);
        const parenIndices = [];
        for (const atom_Group of matchingGroupSpecifiers) {
          // Let parenIndex be CountLeftCapturingParensBefore(groupSpecifier).
          // groupSpecifier is in a Atom_Group, the CountLeftCapturingParensBefore does not count for itself so add 1
          const parenIndex = CountLeftCapturingParensBefore(atom_Group) + 1;
          parenIndices.push(parenIndex);
        }
        return BackreferenceMatcher(rer, parenIndices, direction);
      }
      default:
        throw OutOfRange.exhaustive(node);
    }
  }
  throw OutOfRange.exhaustive(node);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-charactersetmatcher-abstract-operation */
function CharacterSetMatcher(rer: RegExpRecord, A: CharSet, invert: boolean, direction: Direction): Matcher {
  if (rer.UnicodeSets) {
    Assert(!invert);
    // Assert: Every CharSetElement of A consists of a single character.
    Assert(A.characterModeOnly);
  }
  return annotateMatcher(function* CharacterSetMatcher(x, c) {
    const Input = x.input;
    const e = x.endIndex;
    const f = direction === Direction.Forward ? e + 1 : e - 1;
    const InputLength = Input.length;
    if (f < 0 || f > InputLength) {
      return 'failure';
    }
    const index = Math.min(e, f);
    const ch = Input[index] as Character;
    const cc = Canonicalize(rer, ch);
    // If there exists a CharSetElement in A containing exactly one character a such that Canonicalize(rer, a) is cc, let found be true. Otherwise, let found be false.
    const found = A.has(cc, rer);

    if ((!invert && !found) || (invert && found)) {
      return 'failure';
    }
    const cap = x.captures;
    const y = new MatchState(Input, f, cap);
    return yield () => c(y);
  }, [A, invert]);
}

/** https://tc39.es/ecma262/#sec-backreference-matcher */
function BackreferenceMatcher(rer: RegExpRecord, ns: readonly number[], direction: Direction): Matcher {
  return annotateMatcher(function* BackreferenceMatcher(x, c) {
    const Input = x.input;
    const cap = x.captures;
    let r;
    for (const n of ns) {
      if (cap[n] !== undefined) {
        Assert(r === undefined);
        r = cap[n];
      }
    }
    if (r === undefined) {
      return yield () => c(x);
    }
    const e = x.endIndex;
    const rs = r.startIndex;
    const re = r.endIndex;
    const len = re - rs;
    const f = direction === Direction.Forward ? e + len : e - len;
    const InputLength = Input.length;
    if (f < 0 || f > InputLength) {
      return 'failure';
    }
    const g = Math.min(e, f);
    for (let i = 0; i < len; i += 1) {
      if (Canonicalize(rer, Input[rs + i] as Character) !== Canonicalize(rer, Input[g + i] as Character)) {
        return 'failure';
      }
    }
    const y = new MatchState(Input, f, cap);
    return yield () => c(y);
  }, ['BackreferenceMatcher', ns, rer]);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-canonicalize-ch */
export function Canonicalize(rer: RegExpRecord, char: Character): Character {
  if (HasEitherUnicodeFlag(rer) && rer.IgnoreCase) {
    // If the file CaseFolding.txt of the Unicode Character Database provides a simple or common case folding mapping for ch, return the result of applying that mapping to ch.
    const mapped = Unicode.SimpleOrCommonCaseFoldingMapping(char);
    if (mapped) {
      return mapped;
    } else {
      return char;
    }
  }
  if (!rer.IgnoreCase) {
    return char;
  }
  Assert(char.length === 1, 'ch is a UTF-16 code unit');
  const codePoint = Unicode.toCodePoint(char);
  const mappedCodePoints = Unicode.toUppercase(codePoint);
  if (CodePointsToString(mappedCodePoints).length !== 1) {
    return char;
  }
  // Assert: The number of elements in mappedCodePoints is 1.
  Assert([...mappedCodePoints].length === 1);
  const mappedCodePoint = mappedCodePoints.codePointAt(0)! as CodePoint;
  if (codePoint >= 128 && mappedCodePoint < 128) {
    return char;
  }
  // Return the code unit whose numeric value is the numeric value of mappedCodePoint.
  return String.fromCharCode(mappedCodePoint) as Character;
}

/** https://tc39.es/ecma262/#sec-updatemodifiers */
function UpdateModifiers(rer: RegExpRecord, add: string, remove: string): RegExpRecord {
  Assert(new Set([...add, ...remove]).size === (add + remove).length);
  const next = { ...rer };
  if (remove.includes('i')) {
    next.IgnoreCase = false;
  } else if (add.includes('i')) {
    next.IgnoreCase = true;
  }
  if (remove.includes('m')) {
    next.Multiline = false;
  } else if (add.includes('m')) {
    next.Multiline = true;
  }
  if (remove.includes('s')) {
    next.DotAll = false;
  } else if (add.includes('s')) {
    next.DotAll = true;
  }
  return next;
}

/** https://tc39.es/ecma262/#sec-compilecharacterclass */
function CompileCharacterClass(node: ParseNode.RegExp.CharacterClass, rer: RegExpRecord): { CharSet: CharSet, Invert: boolean } {
  const A = CompileToCharSet(node.ClassContents, rer);
  return {
    CharSet: rer.UnicodeSets && node.invert ? CharacterComplement(rer, A) : A,
    Invert: rer.UnicodeSets ? false : node.invert,
  };
}

/** https://tc39.es/ecma262/#sec-compiletocharset */
function CompileToCharSet(
  node:
  | ParseNode.RegExp.ClassContents
  | ParseNode.RegExp.ClassAtom
  | ParseNode.RegExp.ClassEscape
  | ParseNode.RegExp.CharacterClassEscape
  | ParseNode.RegExp.UnicodePropertyValueExpression
  | ParseNode.RegExp.ClassUnion
  | ParseNode.RegExp.ClassIntersection
  | ParseNode.RegExp.ClassSubtraction
  | ParseNode.RegExp.ClassSetRange
  | ParseNode.RegExp.ClassSetOperand
  | ParseNode.RegExp.NestedClass
  | ParseNode.RegExp.ClassSetCharacter
  | ParseNode.RegExp.ClassStringDisjunction
  // eslint-disable-next-line comma-style
  , rer: RegExpRecord,
): CharSet {
  switch (node.type) {
    //  ClassContents :: [empty]
    //  NonemptyClassRanges :: ClassAtom NonemptyClassRangesNoDash
    //  NonemptyClassRanges :: ClassAtom - ClassAtom ClassContents
    //  NonemptyClassRangesNoDash :: ClassAtomNoDash NonemptyClassRangesNoDash
    //  NonemptyClassRangesNoDash :: ClassAtomNoDash - ClassAtom ClassContents
    case 'ClassContents': {
      if (node.production === 'Empty') {
        return new ConcreteCharSet([]);
      } else if (node.production === 'NonEmptyClassRanges') {
        let allSet: CharSet = new ConcreteCharSet([]);
        for (const range of node.NonemptyClassRanges) {
          if (isArray(range)) {
            const [A, B] = range;
            const a = CompileToCharSet(A, rer);
            const b = CompileToCharSet(B, rer);
            Assert(a instanceof ConcreteCharSet && b instanceof ConcreteCharSet);
            const set = CharacterRange(a, b);
            allSet = CharSet.union(allSet, set);
          } else {
            const set = CompileToCharSet(range, rer);
            allSet = CharSet.union(allSet, set);
          }
        }
        return allSet!;
      } else if (node.production === 'ClassSetExpression') {
        return CompileToCharSet(node.ClassSetExpression, rer);
      }
      throw OutOfRange.exhaustive(node);
    }
    //  ClassAtom :: -
    //  ClassAtomNoDash :: SourceCharacter but not one of \ or ] or -
    case 'ClassAtom': {
      if (node.production === '-') {
        return new ConcreteCharSet(['-' as Character]);
      } else if (node.production === 'SourceCharacter') {
        return new ConcreteCharSet([node.SourceCharacter as Character]);
      } else if (node.production === 'ClassEscape') {
        return CompileToCharSet(node.ClassEscape, rer);
      }
      throw OutOfRange.exhaustive(node);
    }
    //  ClassEscape :: -
    //  ClassEscape :: CharacterEscape
    case 'ClassEscape': {
      if (node.production === 'CharacterClassEscape') {
        return CompileToCharSet(node.CharacterClassEscape, rer);
      }
      const cv = CharacterValue(node);
      return new ConcreteCharSet([Unicode.toCharacter(cv)]);
    }
    //  CharacterClassEscape :: d d s S w W
    //  CharacterClassEscape :: p{ UnicodePropertyValueExpression }
    //  CharacterClassEscape :: P{ UnicodePropertyValueExpression }
    case 'CharacterClassEscape': {
      switch (node.production) {
        case 'd':
          return new ConcreteCharSet('0123456789' as Iterable<Character>);
        case 'D':
          return CharacterComplement(rer, new ConcreteCharSet('0123456789' as Iterable<Character>));
        case 's':
          return new VirtualCharSet((char) => isWhitespace(char) || isLineTerminator(char));
        case 'S':
          return new VirtualCharSet(((char) => !isWhitespace(char) && !isLineTerminator(char)));
        case 'w':
          return MaybeSimpleCaseFolding(rer, WordCharacters(rer));
        case 'W':
          return CharacterComplement(rer, MaybeSimpleCaseFolding(rer, WordCharacters(rer)));
        case 'p':
          return CompileToCharSet(node.UnicodePropertyValueExpression!, rer);
        case 'P': {
          const S = CompileToCharSet(node.UnicodePropertyValueExpression!, rer);
          // Cannot implement: Assert: S contains only single code points.
          return CharacterComplement(rer, S);
        }
        default:
          throw OutOfRange.exhaustive(node);
      }
    }
    //  UnicodePropertyValueExpression :: UnicodePropertyName = UnicodePropertyValue
    //  UnicodePropertyValueExpression :: LoneUnicodePropertyNameOrValue
    case 'UnicodePropertyValueExpression': {
      if (node.production === '=') {
        const ps = node.UnicodePropertyName;
        const p = UnicodeMatchProperty(rer, ps);
        Assert(p in Table69_NonbinaryUnicodeProperties);
        __ts_cast__<Table69_NonbinaryUnicodePropertiesCanonicalized>(p);
        const vs = node.UnicodePropertyValue;
        let v: string;
        let A: CharSet;
        if (p === 'Script_Extensions') {
          Assert(vs in PropertyValueAliases.Script);
          // Let v be the Set containing the “short name”, “long name”, and any other aliases corresponding with value vs for property “Script” in PropertyValueAliases.txt.
          v = UnicodeMatchPropertyValue('Script', vs);
          // Return the CharSet containing all Unicode code points whose character database definition includes the property “Script_Extensions” with value having a non-empty intersection with v.
          A = new VirtualCharSet((ch, rer) => Unicode.characterMatchPropertyValue(ch, p, v, rer));
        } else {
          v = UnicodeMatchPropertyValue(p, vs);
          // Let A be the CharSet containing all Unicode code points whose character database definition includes the property p with value v.
          A = new VirtualCharSet((ch, rer) => Unicode.characterMatchPropertyValue(ch, p, v, rer));
        }
        return MaybeSimpleCaseFolding(rer, A);
      } else {
        const s = node.LoneUnicodePropertyNameOrValue;
        if (s in PropertyValueAliases.General_Category) {
          const v = UnicodeMatchPropertyValue('General_Category', s);
          // Return the CharSet containing all Unicode code points whose character database definition includes the property “General_Category” with value v.
          return new VirtualCharSet((ch, rer) => Unicode.characterMatchPropertyValue(ch, 'General_Category', v, rer));
        }
        const p = UnicodeMatchProperty(rer, s);
        Assert(p in Table70_BinaryUnicodeProperties || p in Table71_BinaryPropertyOfStrings);
        // Let A be the CharSet containing all CharSetElements whose character database definition includes the property p with value “True”.
        if (p in Table71_BinaryPropertyOfStrings) {
          const A = ConcreteStringSet.of(Unicode.getStringPropertySet(p as keyof typeof Table71_BinaryPropertyOfStrings));
          return MaybeSimpleCaseFolding(rer, A);
        }
        const A = new VirtualCharSet((ch, rer) => Unicode.characterMatchPropertyValue(ch, p as Table69_NonbinaryUnicodePropertiesCanonicalized, undefined, rer));
        return MaybeSimpleCaseFolding(rer, A);
      }
    }
    //  ClassUnion :: ClassSetRange ClassUnion
    //  ClassUnion :: ClassSetOperand ClassUnion
    case 'ClassUnion': {
      return CharSet.union(...node.union.map((part): CharSet => CompileToCharSet(part, rer)));
    }
    //  ClassIntersection :: ClassSetOperand && ClassSetOperand
    //  ClassIntersection :: ClassIntersection && ClassSetOperand
    case 'ClassIntersection': {
      return CharSet.intersection(...node.operands.map((part): CharSet => CompileToCharSet(part, rer)));
    }
    //  ClassSubtraction :: ClassSetOperand -- ClassSetOperand
    //  ClassSubtraction :: ClassSubtraction -- ClassSetOperand
    case 'ClassSubtraction': {
      const mainSet = CompileToCharSet(node.operands[0], rer);
      return CharSet.subtract(mainSet, false, ...node.operands.slice(1).map((part) => CompileToCharSet(part, rer)));
    }
    //  ClassSetRange :: ClassSetCharacter - ClassSetCharacter
    case 'ClassSetRange': {
      const A = CompileToCharSet(node.left, rer);
      const B = CompileToCharSet(node.right, rer);
      Assert(A instanceof ConcreteCharSet && B instanceof ConcreteCharSet);
      return MaybeSimpleCaseFolding(rer, CharacterRange(A, B));
    }
    //  ClassSetOperand :: ClassSetCharacter
    //  ClassSetOperand :: ClassStringDisjunction
    //  ClassSetOperand :: NestedClass
    case 'ClassSetOperand': {
      if (node.production === 'NestedClass') {
        return CompileToCharSet(node.NestedClass, rer);
      } else if (node.production === 'ClassSetCharacter') {
        const A = CompileToCharSet(node.ClassSetCharacter, rer);
        return MaybeSimpleCaseFolding(rer, A);
      } else if (node.production === 'ClassStringDisjunction') {
        const A = CompileToCharSet(node.ClassStringDisjunction, rer);
        return MaybeSimpleCaseFolding(rer, A);
      }
      throw OutOfRange.exhaustive(node);
    }
    //  NestedClass :: [ ClassContents ]
    //  NestedClass :: [^ ClassContents ]
    //  NestedClass :: \ CharacterClassEscape
    case 'NestedClass': {
      if (node.production === 'ClassContents') {
        const A = CompileToCharSet(node.ClassContents, rer);
        if (node.invert) {
          return CharacterComplement(rer, A);
        }
        return A;
      }
      if (node.CharacterClassEscape) {
        return CompileToCharSet(node.CharacterClassEscape, rer);
      }
      throw new Assert.Error('Invalid AST');
    }
    // ClassStringDisjunction :: \q{ ClassStringDisjunctionContents }
    // ClassStringDisjunctionContents :: ClassString
    // ClassStringDisjunctionContents :: ClassString | ClassStringDisjunctionContents
    case 'ClassStringDisjunction': {
      const s = node.ClassString.map((node) => CompileClassSetString(node, rer));
      const A = ConcreteStringSet.of(s);
      return A;
    }
    // ClassSetCharacter ::
    //   SourceCharacter but not ClassSetSyntaxCharacter
    //   \ CharacterEscape
    //   \ ClassSetReservedPunctuator
    case 'ClassSetCharacter': {
      const cv = CharacterValue(node);
      const A = new ConcreteCharSet([Unicode.toCharacter(cv)]);
      return A;
    }
    default:
      throw OutOfRange.exhaustive(node);
  }
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-characterrange-abstract-operation */
function CharacterRange(A: ConcreteCharSet, B: ConcreteCharSet): CharSet {
  const a = A.soleChar();
  const b = B.soleChar();
  const i = Unicode.toCodePoint(a);
  const j = Unicode.toCodePoint(b);
  Assert(i <= j);

  const canonicalized: Record<string, Set<Character>> = {};
  // Return the CharSet containing all characters with a character value in the inclusive interval from i to j.
  return new VirtualCharSet((ch, rer) => {
    const cp = Unicode.toCodePoint(ch);
    if (rer) {
      const canonicalizedKey = JSON.stringify(rer);
      if (canonicalized[canonicalizedKey] === undefined) {
        canonicalized[canonicalizedKey] = new Set();
        const set = canonicalized[canonicalizedKey];
        for (let index = i; index <= j; index = index + 1 as CodePoint) {
          const ch = Unicode.toCharacter(index);
          set.add(Canonicalize(rer, ch));
        }
      }
      return canonicalized[canonicalizedKey].has(ch);
    }
    return cp >= i && cp <= j;
  });
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-haseitherunicodeflag-abstract-operation */
function HasEitherUnicodeFlag(rer: RegExpRecord) {
  return rer.Unicode || rer.UnicodeSets;
}

/** https://tc39.es/ecma262/#sec-wordcharacters */
function WordCharacters(rer: RegExpRecord): CharSet {
  const basicWordChars = new ConcreteCharSet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_' as Iterable<Character>);
  const extraWordChars = new VirtualCharSet((c) => Unicode.isCharacter(c) && !basicWordChars.has(c, rer) && basicWordChars.has(Canonicalize(rer, c), rer));
  return CharSet.union(basicWordChars, extraWordChars);
}

/** https://tc39.es/ecma262/#sec-allcharacters */
function AllCharacters(rer: RegExpRecord): VirtualCharSet {
  if (rer.UnicodeSets && rer.IgnoreCase) {
    // Return the CharSet containing all Unicode code points c that do not have a Simple Case Folding mapping (that is, scf(c)=c).
    return new VirtualCharSet((char) => Unicode.isCharacter(char) && Unicode.SimpleOrCommonCaseFoldingMapping(char) !== char);
  } else if (HasEitherUnicodeFlag(rer)) {
    // Return the CharSet containing all code point values.
    return new VirtualCharSet((char) => Unicode.isCharacter(char));
  } else {
    // Return the CharSet containing all code unit values.
    return new VirtualCharSet((ch) => ch.length === 1);
  }
}

/** https://tc39.es/ecma262/#sec-maybesimplecasefolding */
function MaybeSimpleCaseFolding(rer: RegExpRecord, A: CharSet): CharSet {
  if (!rer.UnicodeSets || !rer.IgnoreCase) {
    return A;
  }
  const strings = A.getStrings();
  const scfString = strings.map((s) => Array.from(Unicode.iterateCharacterByCodePoint(s)).map(Unicode.SimpleOrCommonCaseFoldingMapping).join('') as ListOfCharacter);

  const scfChar: CharTester = (ch, rer) => {
    // before optimized:
    // a. Let t be an empty sequence of characters.
    // b. For each single code point cp in s, do
    //   i. Append scf(cp) to t.
    // c. Add t to B.

    // it means B only contains scf(A)
    // we optimized it as:
    // if scf(ch) !== ch, it means ch is impossible to appear in scf(A).
    let scf = '';
    for (const cp of Unicode.iterateCharacterByCodePoint(ch)) {
      scf += Unicode.SimpleOrCommonCaseFoldingMapping(cp);
    }
    if (scf !== ch) {
      return false;
    }
    return A.has(ch, rer);
  };
  return CharSet.union(ConcreteStringSet.of(scfString), new VirtualCharSet(scfChar));
}

/** https://tc39.es/ecma262/#sec-charactercomplement */
function CharacterComplement(rer: RegExpRecord, S: CharSet): VirtualCharSet {
  const A = AllCharacters(rer);
  // Return the CharSet containing the CharSetElements of A which are not also CharSetElements of S.
  return new VirtualCharSet((ch, rer) => A.has(ch, rer) && !S.has(ch, rer));
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-unicodematchproperty-p */
function UnicodeMatchProperty(rer: RegExpRecord, p: string): string {
  // If rer.[[UnicodeSets]] is true and _p_ is listed in the “Property name” column of Table 71, then, then
  if (rer.UnicodeSets && p in Table71_BinaryPropertyOfStrings) {
    return p;
  }
  // Assert: p is listed in the “Property name and aliases” column of Table 69 or Table 70.
  // Return the “canonical property name” corresponding to the property name or property alias p in Table 69 or Table 70.
  if (p in Table69_NonbinaryUnicodeProperties) {
    return Table69_NonbinaryUnicodeProperties[p as keyof typeof Table69_NonbinaryUnicodeProperties];
  }
  if (p in Table70_BinaryUnicodeProperties) {
    return Table70_BinaryUnicodeProperties[p as keyof typeof Table70_BinaryUnicodeProperties];
  }
  Assert(false, 'p in Table69_NonbinaryUnicodeProperties || p in Table70_BinaryUnicodeProperties');
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-unicodematchpropertyvalue-p-v */
function UnicodeMatchPropertyValue(p: string, v: string): string {
  // Assert: p is a canonical, unaliased Unicode property name listed in the “Canonical property name” column of Table 69.
  const CanonicalizedP = Table69_NonbinaryUnicodeProperties[p as keyof typeof Table69_NonbinaryUnicodeProperties];
  Assert(p in Table69_NonbinaryUnicodeProperties && CanonicalizedP === p);

  const table = PropertyValueAliases[CanonicalizedP];
  // Assert: v is a property value or property value alias for the Unicode property p listed in PropertyValueAliases.txt.
  Assert(v in table);
  // If v is a “short name” or other alias associated with some “long name” l for property name p in PropertyValueAliases.txt, return l; otherwise, return v.
  return table[v as keyof typeof table] as string;
}

/** https://tc39.es/ecma262/#sec-compileclasssetstring */
function CompileClassSetString(node: ParseNode.RegExp.ClassSetCharacter[], rer: RegExpRecord): ListOfCharacter {
  let str = '';
  for (const char of node) {
    const cs = CompileToCharSet(char, rer);
    Assert(cs instanceof ConcreteCharSet);
    const s1 = cs.soleChar();
    str += s1;
  }
  return str as ListOfCharacter;
}

// SS:
export function CountLeftCapturingParensWithin(node: ParseNode.RegExp.Term_Atom | ParseNode.RegExp.Pattern): number {
  if (node.type === 'Pattern') {
    return node.capturingGroups.length;
  }
  return node.capturingParenthesesWithin;
}
function CountLeftCapturingParensBefore(node: ParseNode.RegExp.Term_Atom | ParseNode.RegExp.Atom_Group): number {
  return node.leftCapturingParenthesesBefore;
}
export function IsCharacterClass(node: ParseNode.RegExp.ClassAtom) {
  return node.production === 'ClassEscape' && node.ClassEscape.production === 'CharacterClassEscape';
}
function CapturingGroupNumber(node: ParseNode.RegExp.DecimalEscape): number {
  return node.value;
}
function GroupSpecifiersThatMatch(node: ParseNode.RegExp.AtomEscape_CaptureGroupName) {
  return node.groupSpecifiersThatMatchSelf;
}

// for debugging purpose
type MatcherWithComment = Matcher & { comment: unknown };
function annotateMatcher(matcher: Matcher, comment: unknown): Matcher {
  Object.assign(matcher, { comment });
  return matcher;
}
