import {
  Table70_BinaryUnicodeProperties,
  Table69_NonbinaryUnicodeProperties,
  type UnicodeCharacter,
  CountLeftCapturingParensWithin,
  type Character,
  IsCharacterClass,
  type CodePoint,
  Table71_BinaryPropertyOfStrings,
  isLeadingSurrogate,
  isTrailingSurrogate,
} from '../runtime-semantics/all.mts';
import {
  CharacterValue,
  UTF16SurrogatePairToCodePoint,
  type CharacterValueAcceptNode,
} from '../static-semantics/all.mts';
// @ts-ignore
import PropertyValueAliases from '../unicode/PropertyValueAliases.json' with { type: 'json' };
import { __ts_cast__, OutOfRange } from '../utils/language.mts';
import {
  isIdentifierStart,
  isIdentifierPart,
  isHexDigit,
} from './Lexer.mts';
import type { ParseNode } from './ParseNode.mts';
import {
  Assert, isErrorObject, surroundingAgent, Throw, ThrowCompletion, type ErrorObject, type Mutable,
} from '#self';

export const isSyntaxCharacter = (c: string) => '^$\\.*+?()[]{}|'.includes(c);
const isClosingSyntaxCharacter = (c: string) => ')|'.includes(c);
const isDecimalDigit = (c: string) => /[0123456789]/u.test(c);
const isControlLetter = (c: string) => /[a-zA-Z]/u.test(c);
/** https://tc39.es/ecma262/#table-controlescape-code-point-values */
export const isControlEscape = (c: CodePoint) => c >= 9 && c <= 13;
export const isAsciiLetter = (c: CodePoint) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

enum ParserContext {
  None = 0,
  UnicodeMode = 1 << 0,
  NamedCaptureGroups = 1 << 1,
  UnicodeSetMode = 1 << 2,
}

export interface RegExpParserContext { UnicodeMode?: boolean; NamedCaptureGroups?: boolean; UnicodeSetsMode?: boolean; }

export class RegExpParser {
  private source: string;

  private position = 0;

  get debug() {
    return `${this.source.slice(0, this.position)}👀${this.source.slice(this.position)}`;
  }

  private capturingGroups: Mutable<ParseNode.RegExp.Pattern['capturingGroups']> = [];

  private leftCapturingParenthesesBefore = 0;

  private decimalEscapes: { readonly value: number, readonly position: number }[] = [];

  private groupNameRefs: ParseNode.RegExp.AtomEscape_CaptureGroupName[] = [];

  private groupNameThatMatches: Record<string, ParseNode.RegExp.Atom_Group[]> = Object.create(null);

  private getAllGroupsWithName(name: string) {
    this.groupNameThatMatches[name] ??= [];
    return this.groupNameThatMatches[name];
  }

  private state = ParserContext.None;

  constructor(source: string, private decorateError?: (error: ErrorObject, position: number) => void) {
    this.source = source;
  }

  scope<T>(flags: RegExpParserContext, f: () => T): T {
    const oldState = this.state;

    if (flags.UnicodeMode === true) {
      this.state |= ParserContext.UnicodeMode;
    } else if (flags.UnicodeMode === false) {
      this.state &= ~ParserContext.UnicodeMode;
    }

    if (flags.NamedCaptureGroups === true) {
      this.state |= ParserContext.NamedCaptureGroups;
    } else if (flags.NamedCaptureGroups === false) {
      this.state &= ~ParserContext.NamedCaptureGroups;
    }

    if (flags.UnicodeSetsMode === true) {
      this.state |= ParserContext.UnicodeSetMode;
    } else if (flags.UnicodeSetsMode === false) {
      this.state &= ~ParserContext.UnicodeSetMode;
    }

    const r = f();

    this.state = oldState;

    return r;
  }

  private get inUnicodeMode() {
    return (this.state & ParserContext.UnicodeMode) === ParserContext.UnicodeMode;
  }

  private get inNamedCaptureGroups() {
    return (this.state & ParserContext.NamedCaptureGroups) === ParserContext.NamedCaptureGroups;
  }

  private get inUnicodeSetMode() {
    return (this.state & ParserContext.UnicodeSetMode) === ParserContext.UnicodeSetMode;
  }

  private raise(error: ThrowCompletion, position = this.position): never {
    if (isErrorObject(error.Value)) {
      this.decorateError?.(error.Value, position);
    }
    throw error.Value;
  }

  private peek(length = 1) {
    return this.source.slice(this.position, this.position + length);
  }

  private test(c: string) {
    return this.source.slice(this.position, this.position + c.length) === c;
  }

  private eat(c: string) {
    if (this.source.slice(this.position, this.position + c.length) === c) {
      this.position += c.length;
      return true;
    }
    return false;
  }

  private next() {
    const c = this.source[this.position];
    if (!c) {
      this.raise(Throw.SyntaxError('Unexpected end of input'), this.position - 1);
    }
    this.position += 1;
    return c;
  }

  private expect(c: string) {
    if (!this.eat(c)) {
      this.raise(Throw.SyntaxError('Expected $1 but got $2', c, this.peek()));
    }
  }

  // Pattern ::
  //   Disjunction
  parsePattern(): ParseNode.RegExp.Pattern {
    const node: ParseNode.RegExp.Pattern = {
      type: 'Pattern',
      capturingGroups: this.capturingGroups,
      Disjunction: this.parseDisjunction(),
    };
    if (this.position < this.source.length) {
      this.raise(Throw.SyntaxError('Unexpected token'));
    }
    // AtomEscape :: DecimalEscape
    // EE: It is a Syntax Error if the CapturingGroupNumber of DecimalEscape is strictly greater than CountLeftCapturingParensWithin(the Pattern containing AtomEscape).
    this.decimalEscapes.forEach((d) => {
      if (d.value > node.capturingGroups.length) {
        this.raise(Throw.SyntaxError('There is no $1 capture groups', d.value), d.position);
      }
    });
    // AtomEscape :: k GroupName
    // EE: It is a Syntax Error if GroupSpecifiersThatMatch(GroupName) is empty.
    this.groupNameRefs.forEach((g) => {
      if (!node.capturingGroups.find((x) => g.production === 'CaptureGroupName' && x.GroupName === g.GroupName)) {
        this.raise(Throw.SyntaxError('There is no capture group called $1', JSON.stringify(g.GroupName)), g.position);
      }
    });
    // EE: It is a Syntax Error if CountLeftCapturingParensWithin(Pattern) ≥ 2**32 - 1.
    if (CountLeftCapturingParensWithin(node) >= 2 ** 32 - 1) {
      this.raise(Throw.SyntaxError('Too many capturing groups'));
    }
    return node;
  }

  // in case ((?<a>x)|(?<a>y))|b, after we check the inner Disjunction, we need to mark them as safe,
  // so when checking the outer Disjunction, we don't make a false positive
  private disjunctionCheckedCaptureGroups = new Set<unknown>();

  // Disjunction ::
  //   Alternative
  //   Alternative `|` Disjunction
  private parseDisjunction(): ParseNode.RegExp.Disjunction {
    const beforeCaptureGroups = this.capturingGroups.length;
    const Alternative = this.parseAlternative();
    const node: Mutable<ParseNode.RegExp.Disjunction> = {
      type: 'Disjunction',
      Alternative,
      Disjunction: undefined,
    };
    const afterAlternativeCaptureGroups = this.capturingGroups.length;
    if (this.eat('|')) {
      node.Disjunction = this.parseDisjunction();
    }
    // EE: It is a Syntax Error if Pattern contains two distinct GroupSpecifiers x and y such that the CapturingGroupName of x is the CapturingGroupName of y and such that MightBothParticipate(x, y) is true.
    const alternativeSeenNameGroups = new Set();
    this.capturingGroups.slice(beforeCaptureGroups, afterAlternativeCaptureGroups).forEach((x) => {
      if (this.disjunctionCheckedCaptureGroups.has(x)) {
        return;
      }
      if (x.GroupName) {
        if (alternativeSeenNameGroups.has(x.GroupName)) {
          this.raise(Throw.SyntaxError('Duplicated capture group $1', JSON.stringify(x.GroupName)), x.position);
        }
        alternativeSeenNameGroups.add(x.GroupName);
      }
      this.disjunctionCheckedCaptureGroups.add(x);
    });

    const disjunctionSeenNameGroups = new Set();
    this.capturingGroups.slice(afterAlternativeCaptureGroups).forEach((x) => {
      if (this.disjunctionCheckedCaptureGroups.has(x)) {
        return;
      }
      if (x.GroupName) {
        if (disjunctionSeenNameGroups.has(x.GroupName)) {
          this.raise(Throw.SyntaxError('Duplicated capture group $1', JSON.stringify(x.GroupName)), x.position);
        }
        disjunctionSeenNameGroups.add(x.GroupName);
      }
      this.disjunctionCheckedCaptureGroups.add(x);
    });
    return node;
  }


  // Alternative ::
  //   [empty]
  //   Term Alternative
  private parseAlternative(): ParseNode.RegExp.Alternative {
    const Term: ParseNode.RegExp.Term[] = [];
    const node: Mutable<ParseNode.RegExp.Alternative> = {
      type: 'Alternative',
      Term,
    };
    while (this.position < this.source.length && !isClosingSyntaxCharacter(this.peek())) {
      Term.push(this.parseTerm());
    }
    return node;
  }

  // Term ::
  //   Assertion
  //   Atom
  //   Atom Quantifier
  private parseTerm(): ParseNode.RegExp.Term {
    const assertion = this.maybeParseAssertion();
    if (assertion) {
      return { type: 'Term', production: 'Assertion', Assertion: assertion };
    }
    const capturingParenthesesBefore = this.capturingGroups.length;
    return {
      type: 'Term',
      production: 'Atom',
      leftCapturingParenthesesBefore: this.leftCapturingParenthesesBefore,
      Atom: this.parseAtom(),
      Quantifier: this.maybeParseQuantifier(),
      capturingParenthesesWithin: this.capturingGroups.length - capturingParenthesesBefore,
    };
  }

  // Assertion ::
  //   `^`
  //   `$`
  //   `\` `b`
  //   `\` `B`
  //   `(` `?` `=` Disjunction `)`
  //   `(` `?` `!` Disjunction `)`
  //   `(` `?` `<=` Disjunction `)`
  //   `(` `?` `<!` Disjunction `)`
  private maybeParseAssertion(): ParseNode.RegExp.Assertion | undefined {
    if (this.eat('^')) {
      return { type: 'Assertion', production: '^' };
    }
    if (this.eat('$')) {
      return { type: 'Assertion', production: '$' };
    }

    const peek2 = this.peek(2);
    if (peek2 === '\\b') {
      this.position += 2;
      return { type: 'Assertion', production: 'b' };
    }
    if (peek2 === '\\B') {
      this.position += 2;
      return { type: 'Assertion', production: 'B' };
    }
    if (surroundingAgent.feature('regexp-buffer-boundaries')) {
      if (this.inUnicodeMode && peek2 === '\\A') {
        this.position += 2;
        return { type: 'Assertion', production: 'A' };
      }
      if (this.inUnicodeMode && peek2 === '\\z') {
        this.position += 2;
        return { type: 'Assertion', production: 'z' };
      }
    }

    const peek3 = this.peek(3);
    if (peek3 === '(?=') {
      this.position += 3;
      const d = this.parseDisjunction();
      this.expect(')');
      return {
        type: 'Assertion',
        production: '?=',
        Disjunction: d,
      };
    }
    if (peek3 === '(?!') {
      this.position += 3;
      const d = this.parseDisjunction();
      this.expect(')');
      return {
        type: 'Assertion',
        production: '?!',
        Disjunction: d,
      };
    }

    const peek4 = this.peek(4);
    if (peek4 === '(?<=') {
      this.position += 4;
      const d = this.parseDisjunction();
      this.expect(')');
      return {
        type: 'Assertion',
        production: '?<=',
        Disjunction: d,
      };
    }
    if (peek4 === '(?<!') {
      this.position += 4;
      const d = this.parseDisjunction();
      this.expect(')');
      return {
        type: 'Assertion',
        production: '?<!',
        Disjunction: d,
      };
    }

    return undefined;
  }

  // Quantifier ::
  //   QuantifierPrefix
  //   QuantifierPrefix `?`
  // QuantifierPrefix ::
  //   `*`
  //   `+`
  //   `?`
  //   `{` DecimalDigits `}`
  //   `{` DecimalDigits `,` `}`
  //   `{` DecimalDigits `,` DecimalDigits `}`
  private get isBraceQuantifier(): boolean {
    return /^\{\d+(?:,\d*)?\}/.test(this.source.slice(this.position));
  }

  private maybeParseQuantifier(): ParseNode.RegExp.Quantifier | undefined {
    let QuantifierPrefix: ParseNode.RegExp.Quantifier['QuantifierPrefix'];

    if (this.eat('*')) {
      QuantifierPrefix = { type: 'QuantifierPrefix', production: '*' };
    } else if (this.eat('+')) {
      QuantifierPrefix = { type: 'QuantifierPrefix', production: '+' };
    } else if (this.eat('?')) {
      QuantifierPrefix = { type: 'QuantifierPrefix', production: '?' };
    } else if ((this.inUnicodeMode || this.isBraceQuantifier) && this.eat('{')) {
      const quantifierPos = this.position;
      const DecimalDigits_a = Number.parseInt(this.parseDecimalDigits(), 10);
      let DecimalDigits_b;
      if (this.eat(',')) {
        if (this.test('}')) {
          DecimalDigits_b = Infinity;
        } else {
          DecimalDigits_b = Number.parseInt(this.parseDecimalDigits(), 10);
        }
        // EE: It is a Syntax Error if the MV of the first DecimalDigits is strictly greater than the MV of the second DecimalDigits.
        if (DecimalDigits_a > DecimalDigits_b) {
          this.raise(Throw.SyntaxError('Numbers out of order in quantifier'), quantifierPos);
        }
      }
      QuantifierPrefix = {
        type: 'QuantifierPrefix',
        production: '{}',
        DecimalDigits_a,
        DecimalDigits_b,
      };
      this.expect('}');
    }

    if (QuantifierPrefix!) {
      return {
        type: 'Quantifier',
        QuantifierPrefix,
        QuestionMark: this.eat('?'),
      };
    }

    return undefined;
  }

  // Atom ::
  //   PatternCharacter
  //   `.`
  //   `\` AtomEscape
  //   CharacterClass
  //   `(` GroupSpecifier Disjunction `)`
  //   (? RegularExpressionModifiers : Disjunction )
  //   (? RegularExpressionModifiers - RegularExpressionModifiers : Disjunction )
  private parseAtom(): ParseNode.RegExp.Atom {
    if (this.eat('.')) {
      return { type: 'Atom', production: '.' };
    }
    if (this.eat('\\')) {
      return { type: 'Atom', production: 'AtomEscape', AtomEscape: this.parseAtomEscape() };
    }
    if (this.eat('(')) {
      let node: Mutable<ParseNode.RegExp.Atom_Group | ParseNode.RegExp.Atom_Modifier>;
      if (this.eat('?')) {
        if (this.peek() === '<') {
          this.leftCapturingParenthesesBefore += 1;
          const groupNamePos = this.position + 1;
          const name = this.parseGroupName();
          node = {
            type: 'Atom',
            production: 'Group',
            leftCapturingParenthesesBefore: this.leftCapturingParenthesesBefore - 1,
            GroupSpecifier: name,
            Disjunction: this.parseDisjunction(),
          };
          this.getAllGroupsWithName(name).push(node);
          this.capturingGroups.push({ GroupName: name, position: groupNamePos });
        } else {
          const { PlusModifiers, MinusModifiers } = this.parseAtomModifiers();
          node = {
            type: 'Atom',
            production: 'Modifier',
            leftCapturingParenthesesBefore: this.leftCapturingParenthesesBefore,
            AddModifiers: PlusModifiers,
            RemoveModifiers: MinusModifiers,
            Disjunction: this.parseDisjunction(),
          };
        }
      } else {
        this.leftCapturingParenthesesBefore += 1;
        node = {
          type: 'Atom',
          production: 'Group',
          leftCapturingParenthesesBefore: this.leftCapturingParenthesesBefore - 1,
          GroupSpecifier: undefined,
          Disjunction: this.parseDisjunction(),
        };
        this.capturingGroups.push({ GroupName: undefined, position: this.position });
      }
      this.expect(')');
      return node;
    }
    if (this.test('[')) {
      return {
        type: 'Atom',
        production: 'CharacterClass',
        CharacterClass: this.parseCharacterClass(),
      };
    }
    const isLegacyCharacter = !this.inUnicodeMode && (
      this.peek() === '}' || this.peek() === ']' || (this.peek() === '{' && !this.isBraceQuantifier)
    );
    if (isSyntaxCharacter(this.peek()) && !isLegacyCharacter) {
      this.raise(Throw.SyntaxError('Expected a character but got $1', this.peek()));
    }
    return {
      type: 'Atom',
      production: 'PatternCharacter',
      PatternCharacter: this.parseSourceCharacter(),
    };
  }

  // WhatWeAreParsingHere :: (used in Atom, `<` is for named capture groups)
  //   [empty] [lookahead = `:` or `<`]
  //   RegularExpressionModifiers [lookahead = `:` or `<`]
  //   RegularExpressionModifiers `-` RegularExpressionModifiers [lookahead = `:` or `<`]
  //
  // RegularExpressionModifiers ::
  //   [empty]
  //   RegularExpressionModifiers RegularExpressionModifier
  //
  // RegularExpressionModifier :: one of `i` `m` `s`
  private parseAtomModifiers(): Record<'PlusModifiers' | 'MinusModifiers', ParseNode.RegExp.RegularExpressionModifier[] | undefined> {
    const modifierPos = this.position;
    let modifiers: ParseNode.RegExp.RegularExpressionModifier[] | undefined;
    const result = { PlusModifiers: modifiers, MinusModifiers: modifiers };

    let seenMinus = false;
    while (this.position < this.source.length) {
      if (this.eat(':')) {
        break;
      } else if (this.test('<')) {
        break;
      } else if (this.eat('i')) {
        modifiers ??= [];
        modifiers.push('i');
      } else if (this.eat('m')) {
        modifiers ??= [];
        modifiers.push('m');
      } else if (this.eat('s')) {
        modifiers ??= [];
        modifiers.push('s');
      } else if (this.eat('-')) {
        modifiers ??= [];
        if (seenMinus) {
          this.raise(Throw.SyntaxError('Unexpected - in modifiers'), this.position - 1);
        }
        seenMinus = true;
        result.PlusModifiers = modifiers;
        modifiers = [];
        result.MinusModifiers = modifiers;
      } else {
        this.raise(Throw.SyntaxError('$1 is not a valid modifier', JSON.stringify(this.peek())));
      }
    }
    if (!seenMinus) {
      result.PlusModifiers = modifiers;
    }
    const allModifiers = result.PlusModifiers?.concat(result.MinusModifiers || []);
    // EE: It is a Syntax Error if the source text matched by the first RegularExpressionModifiers and the source text matched by the second RegularExpressionModifiers are both empty.
    if (result.PlusModifiers && result.MinusModifiers && result.PlusModifiers.length + result.MinusModifiers.length === 0) {
      this.raise(Throw.SyntaxError('PlusModifiers and MinusModifiers cannot be both empty.'), this.position - 2);
    }
    // EE: It is a Syntax Error if the source text matched by RegularExpressionModifiers contains the same code point more than once.
    // EE: It is a Syntax Error if the source text matched by the first RegularExpressionModifiers contains the same code point more than once.
    // EE: It is a Syntax Error if the source text matched by the second RegularExpressionModifiers contains the same code point more than once.
    // EE: It is a Syntax Error if any code point in the source text matched by the first RegularExpressionModifiers is also contained in the source text matched by the second RegularExpressionModifiers.
    if (allModifiers?.length && allModifiers.length !== new Set(allModifiers).size) {
      this.raise(Throw.SyntaxError('Repeated modifiers in modifier group'), modifierPos);
    }
    return result;
  }

  // AtomEscape ::
  //   DecimalEscape
  //   CharacterClassEscape
  //   CharacterEscape
  //   [+N] `k` GroupName
  private parseAtomEscape(): ParseNode.RegExp.AtomEscape {
    if (this.inNamedCaptureGroups && this.eat('k')) {
      const groupNamePos = this.position + 1;
      const GroupName = this.parseGroupName();
      const node: ParseNode.RegExp.AtomEscape = {
        type: 'AtomEscape',
        position: groupNamePos,
        production: 'CaptureGroupName',
        GroupName,
        groupSpecifiersThatMatchSelf: this.getAllGroupsWithName(GroupName),
      };
      this.groupNameRefs.push(node);
      return node;
    }
    const CharacterClassEscape = this.maybeParseCharacterClassEscape();
    if (CharacterClassEscape) {
      return {
        type: 'AtomEscape',
        production: 'CharacterClassEscape',
        CharacterClassEscape,
      };
    }
    const DecimalEscape = this.maybeParseDecimalEscape();
    if (DecimalEscape) {
      return {
        type: 'AtomEscape',
        production: 'DecimalEscape',
        DecimalEscape,
      };
    }
    return {
      type: 'AtomEscape',
      production: 'CharacterEscape',
      CharacterEscape: this.parseCharacterEscape(),
    };
  }

  // CharacterEscape ::
  //   ControlEscape
  //   `c` AsciiLetter
  //   `0` [lookahead ∉ DecimalDigit]
  //   HexEscapeSequence
  //   RegExpUnicodeEscapeSequence
  //   IdentityEscape
  //
  // IdentityEscape ::
  //   [+U] SyntaxCharacter
  //   [+U] `/`
  //   [~U] SourceCharacter but not UnicodeIDContinue
  private parseCharacterEscape(): ParseNode.RegExp.CharacterEscape {
    switch (this.peek()) {
      case 'f':
      case 'n':
      case 'r':
      case 't':
      case 'v':
        return {
          type: 'CharacterEscape',
          production: 'ControlEscape',
          ControlEscape: this.next() as 'f' | 'n' | 'r' | 't' | 'v',
        };
      case 'c': {
        this.next();
        const c = this.next();
        if (c === undefined) {
          if (this.inUnicodeMode) {
            this.raise(Throw.SyntaxError('Invalid identity escape'));
          }
          return {
            type: 'CharacterEscape',
            production: 'IdentityEscape',
            IdentityEscape: 'c' as Character,
          };
        }
        const p = c.codePointAt(0)!;
        if ((p >= 65 && p <= 90) || (p >= 97 && p <= 122)) {
          return {
            type: 'CharacterEscape',
            production: 'AsciiLetter',
            AsciiLetter: c,
          };
        }
        if (this.inUnicodeMode) {
          this.raise(Throw.SyntaxError('Invalid identity escape'), this.position - 2);
        }
        return {
          type: 'CharacterEscape',
          production: 'IdentityEscape',
          IdentityEscape: c as Character,
        };
      }
      case 'x':
        if (isHexDigit(this.source[this.position + 1]) && isHexDigit(this.source[this.position + 2])) {
          return {
            type: 'CharacterEscape',
            production: 'HexEscapeSequence',
            HexEscapeSequence: this.parseHexEscapeSequence(),
          };
        }
        if (this.inUnicodeMode) {
          this.raise(Throw.SyntaxError('Invalid identity escape'));
        }
        this.next();
        return {
          type: 'CharacterEscape',
          production: 'IdentityEscape',
          IdentityEscape: 'x' as Character,
        };
      case 'u': {
        const RegExpUnicodeEscapeSequence = this.maybeParseRegExpUnicodeEscapeSequence();
        if (RegExpUnicodeEscapeSequence) {
          return {
            type: 'CharacterEscape',
            production: 'RegExpUnicodeEscapeSequence',
            RegExpUnicodeEscapeSequence,
          };
        }
        if (this.inUnicodeMode) {
          this.raise(Throw.SyntaxError('Invalid identity escape'));
        }
        this.next();
        return {
          type: 'CharacterEscape',
          production: 'IdentityEscape',
          IdentityEscape: 'u' as Character,
        };
      }
      default: {
        const c = this.peek();
        if (c === '') {
          this.raise(Throw.SyntaxError('Unexpected escape'));
        }
        if (c === '0' && !isDecimalDigit(this.source[this.position + 1])) {
          this.position += 1;
          return {
            type: 'CharacterEscape',
            production: c,
          };
        }
        if (this.inUnicodeMode) {
          if (c !== '/' && !isSyntaxCharacter(c)) {
            this.raise(Throw.SyntaxError('Invalid identity escape'));
          }
        }
        return {
          type: 'CharacterEscape',
          production: 'IdentityEscape',
          IdentityEscape: this.next() as Character,
        };
      }
    }
  }

  // DecimalEscape ::
  //   NonZeroDigit DecimalDigits? [lookahead != DecimalDigit]
  private maybeParseDecimalEscape(): ParseNode.RegExp.DecimalEscape | undefined {
    if (isDecimalDigit(this.source[this.position]) && this.source[this.position] !== '0') {
      const start = this.position;
      let buffer = this.source[this.position];
      this.position += 1;
      while (isDecimalDigit(this.source[this.position])) {
        buffer += this.source[this.position];
        this.position += 1;
      }
      const node: ParseNode.RegExp.DecimalEscape = {
        type: 'DecimalEscape',
        position: start,
        value: Number.parseInt(buffer, 10),
      };
      this.decimalEscapes.push(node);
      return node;
    }
    return undefined;
  }

  // CharacterClassEscape ::
  //   `d`
  //   `D`
  //   `s`
  //   `S`
  //   `w`
  //   `W`
  //   [+U] `p{` UnicodePropertyValueExpression `}`
  //   [+U] `P{` UnicodePropertyValueExpression `}`
  private maybeParseCharacterClassEscape(): ParseNode.RegExp.CharacterClassEscape | undefined {
    const peek = this.peek();
    switch (peek) {
      case 'd':
      case 'D':
      case 's':
      case 'S':
      case 'w':
      case 'W':
        this.next();
        return {
          type: 'CharacterClassEscape',
          production: peek,
        };
      case 'p':
      case 'P': {
        if (!this.inUnicodeMode) {
          return undefined;
        }
        this.next();
        this.expect('{');
        let LoneUnicodePropertyNameOrValue = '';
        const namePos = this.position;
        while (true) {
          if (this.position >= this.source.length) {
            this.raise(Throw.SyntaxError('Invalid unicode property name or value'));
          }
          const c = this.source[this.position];
          if (c === '_' || isDecimalDigit(c)) {
            this.position += 1;
            LoneUnicodePropertyNameOrValue += c;
            continue;
          }
          if (!isControlLetter(c)) {
            break;
          }
          this.position += 1;
          LoneUnicodePropertyNameOrValue += c;
        }
        if (LoneUnicodePropertyNameOrValue.length === 0) {
          this.raise(Throw.SyntaxError('Invalid unicode property name or value'));
        }
        let UnicodePropertyValue;
        let valuePos;
        if (this.source[this.position] === '=') {
          this.position += 1;
          valuePos = this.position;
          UnicodePropertyValue = '';
          while (true) {
            if (this.position >= this.source.length) {
              this.raise(Throw.SyntaxError('Invalid unicode property value'), valuePos);
            }
            const c = this.source[this.position];
            if (!isControlLetter(c) && !isDecimalDigit(c) && c !== '_') {
              break;
            }
            this.position += 1;
            UnicodePropertyValue += c;
          }
          if (UnicodePropertyValue.length === 0) {
            this.raise(Throw.SyntaxError('Invalid unicode property value'), valuePos);
          }
        }
        this.expect('}');
        if (UnicodePropertyValue) {
          const UnicodePropertyName = LoneUnicodePropertyNameOrValue;
          // EE: It is a Syntax Error if the source text matched by UnicodePropertyName is not a Unicode property name or property alias listed in the “Property name and aliases” column of Table 69.
          if (!(UnicodePropertyName in Table69_NonbinaryUnicodeProperties)) {
            this.raise(Throw.SyntaxError('Invalid unicode property name'), namePos);
          }
          __ts_cast__<keyof typeof Table69_NonbinaryUnicodeProperties>(UnicodePropertyName);
          if (UnicodePropertyName !== 'Script_Extensions' && UnicodePropertyName !== 'scx') {
            // EE: It is a Syntax Error if the source text matched by UnicodePropertyName is neither Script_Extensions nor scx and the source text matched by UnicodePropertyValue is not a property value or property value alias for the Unicode property or property alias given by the source text matched by UnicodePropertyName listed in PropertyValueAliases.txt.
            if (!((UnicodePropertyValue in PropertyValueAliases[Table69_NonbinaryUnicodeProperties[UnicodePropertyName]]))) {
              this.raise(Throw.SyntaxError('Invalid unicode property value'), valuePos);
            }
          } else if (!(UnicodePropertyValue in PropertyValueAliases.Script)) {
            // EE: It is a Syntax Error if the source text matched by UnicodePropertyName is either Script_Extensions or scx and the source text matched by UnicodePropertyValue is not a property value or property value alias for the Unicode property Script (sc) listed in PropertyValueAliases.txt.
            this.raise(Throw.SyntaxError('Invalid unicode property value'), valuePos);
          }
          return {
            type: 'CharacterClassEscape',
            production: peek,
            UnicodePropertyValueExpression: {
              type: 'UnicodePropertyValueExpression',
              production: '=',
              UnicodePropertyName,
              UnicodePropertyValue,
            },
          };
        }
        // UnicodePropertyValueExpression :: LoneUnicodePropertyNameOrValue
        // EE: It is a Syntax Error if the source text matched by LoneUnicodePropertyNameOrValue is not a Unicode property value or property value alias for the General_Category (gc) property listed in PropertyValueAliases.txt, nor a binary property or binary property alias listed in the “Property name and aliases” column of Table 70, nor a binary property of strings listed in the “Property name” column of Table 71.
        if (
          !(LoneUnicodePropertyNameOrValue in PropertyValueAliases.General_Category)
          && !(LoneUnicodePropertyNameOrValue in Table70_BinaryUnicodeProperties)
          && !(LoneUnicodePropertyNameOrValue in Table71_BinaryPropertyOfStrings)
        ) {
          this.raise(Throw.SyntaxError('Invalid unicode property'), namePos);
        }
        // EE: It is a Syntax Error if the enclosing Pattern does not have a [UnicodeSetsMode] parameter and the source text matched by LoneUnicodePropertyNameOrValue is a binary property of strings listed in the “Property name” column of Table 71.
        if (LoneUnicodePropertyNameOrValue in Table71_BinaryPropertyOfStrings && !this.inUnicodeSetMode) {
          this.raise(Throw.SyntaxError('$1 can only be used with v flag', LoneUnicodePropertyNameOrValue), namePos);
        }
        // EE: It is a Syntax Error if MayContainStrings of the UnicodePropertyValueExpression is true.
        if (peek === 'P' && LoneUnicodePropertyNameOrValue in Table71_BinaryPropertyOfStrings) {
          this.raise(Throw.SyntaxError('$1 cannot be inverted', LoneUnicodePropertyNameOrValue), namePos - 2);
        }
        return {
          type: 'CharacterClassEscape',
          production: peek,
          UnicodePropertyValueExpression: {
            type: 'UnicodePropertyValueExpression',
            production: 'Lone',
            LoneUnicodePropertyNameOrValue,
          },
        };
      }
      default:
        return undefined;
    }
  }

  // CharacterClass ::
  //   `[` ClassContents `]`
  //   `[` `^` ClassContents `]`
  private parseCharacterClass(): ParseNode.RegExp.CharacterClass {
    this.expect('[');
    const invertPos = this.position;
    const invert = this.eat('^');
    const node: ParseNode.RegExp.CharacterClass = {
      type: 'CharacterClass',
      invert,
      ClassContents: this.parseClassContents(),
    };
    // CharacterClass :: [^ ClassContents ]
    // EE: It is a Syntax Error if MayContainStrings of the ClassContents is true.
    if (invert && MayContainStrings(node.ClassContents)) {
      this.raise(Throw.SyntaxError('This class cannot be inverted'), invertPos);
    }
    this.expect(']');
    return node;
  }

  // ClassContents
  //   [empty]
  //   [~UnicodeSetMode] NonemptyClassRanges
  //   [+UnicodeSetMode] ClassSetExpression
  private parseClassContents(): ParseNode.RegExp.ClassContents {
    // [empty]
    if (this.test(']')) {
      return { type: 'ClassContents', production: 'Empty' };
    }
    if (this.inUnicodeSetMode) {
      return {
        type: 'ClassContents',
        production: 'ClassSetExpression',
        ClassSetExpression: this.parseClassSetExpression(),
      };
    } else {
      return {
        type: 'ClassContents',
        production: 'NonEmptyClassRanges',
        NonemptyClassRanges: this.parseNonemptyClassRanges(),
      };
    }
  }

  // NonemptyClassRanges ::
  //   ClassAtom
  //   ClassAtom NonemptyClassRangesNoDash
  //   ClassAtom `-` ClassAtom [empty]
  //   ClassAtom `-` ClassAtom NonemptyClassRanges
  private parseNonemptyClassRanges(): ParseNode.RegExp.ClassRange[] {
    Assert(!this.inUnicodeSetMode);
    const ranges: Mutable<ParseNode.RegExp.NonEmptyClassRanges> = [];
    while (!this.test(']')) {
      if (this.position >= this.source.length) {
        this.raise(Throw.SyntaxError('Unexpected end of CharacterClass'));
      }
      const atomPos = this.position;
      const atom = this.parseClassAtom();
      if (this.eat('-')) {
        if (this.test(']')) {
          // [\w-] is valid (\w ++ "-")
          ranges.push(atom);
          ranges.push({ type: 'ClassAtom', production: '-' });
        } else {
          // EE: It is a Syntax Error if IsCharacterClass of the first ClassAtom is true or IsCharacterClass of the second ClassAtom is true.
          if (atom.production === 'ClassEscape' && atom.ClassEscape.production === 'CharacterClassEscape') {
            this.raise(Throw.SyntaxError('Invalid class range'), atomPos);
          }
          const atom2Pos = this.position;
          const atom2 = this.parseClassAtom();
          // EE: It is a Syntax Error if IsCharacterClass of the first ClassAtom is false, IsCharacterClass of the second ClassAtom is false, and the CharacterValue of the first ClassAtom is strictly greater than the CharacterValue of the second ClassAtom.
          // EE: It is a Syntax Error if IsCharacterClass of ClassAtomNoDash is false, IsCharacterClass of ClassAtom is false, and the CharacterValue of ClassAtomNoDash is strictly greater than the CharacterValue of ClassAtom.
          if (!IsCharacterClass(atom) && !IsCharacterClass(atom2) && CharacterValue(atom as CharacterValueAcceptNode) > CharacterValue(atom2 as CharacterValueAcceptNode)) {
            this.raise(Throw.SyntaxError('Invalid class range'), atomPos);
          }
          // EE: It is a Syntax Error if IsCharacterClass of ClassAtomNoDash is true or IsCharacterClass of ClassAtom is true.
          if (IsCharacterClass(atom)) {
            this.raise(Throw.SyntaxError('Invalid class range'), atomPos);
          }
          if (IsCharacterClass(atom2)) {
            this.raise(Throw.SyntaxError('Invalid class range'), atom2Pos);
          }
          ranges.push([atom, atom2]);
        }
      } else {
        ranges.push(atom);
      }
    }
    return ranges;
  }

  // ClassAtom ::
  //   `-`
  //   ClassAtomNoDash
  // ClassAtomNoDash ::
  //   SourceCharacter but not one of `\` or `]` or `-`
  //   `\` ClassEscape
  // ClassEscape :
  //   `b`
  //   [+U] `-`
  //   CharacterClassEscape
  //   CharacterEscape
  private parseClassAtom(): ParseNode.RegExp.ClassAtom {
    if (this.eat('\\')) {
      if (this.eat('b')) {
        return { type: 'ClassAtom', production: 'ClassEscape', ClassEscape: { type: 'ClassEscape', production: 'b' } };
      }
      if (this.inUnicodeMode && this.eat('-')) {
        return { type: 'ClassAtom', production: '-' };
      }
      const CharacterClassEscape = this.maybeParseCharacterClassEscape();
      if (CharacterClassEscape) {
        return {
          type: 'ClassAtom',
          production: 'ClassEscape',
          ClassEscape: { type: 'ClassEscape', production: 'CharacterClassEscape', CharacterClassEscape },
        };
      }
      return {
        type: 'ClassAtom',
        production: 'ClassEscape',
        ClassEscape: {
          type: 'ClassEscape',
          production: 'CharacterEscape',
          CharacterEscape: this.parseCharacterEscape(),
        },
      };
    }
    return {
      type: 'ClassAtom',
      production: 'SourceCharacter',
      SourceCharacter: this.parseSourceCharacter(),
    };
  }

  private parseSourceCharacter(): Character {
    if (this.inUnicodeMode || this.inUnicodeSetMode) {
      const lead = this.source.charCodeAt(this.position);
      const trail = this.source.charCodeAt(this.position + 1);
      if (trail && isLeadingSurrogate(lead) && isTrailingSurrogate(trail)) {
        return (this.next() + this.next()) as UnicodeCharacter;
      }
    }
    return this.next() as Character;
  }

  private parseGroupName(): string {
    this.expect('<');
    const RegExpIdentifierName = this.parseRegExpIdentifierName();
    this.expect('>');
    return RegExpIdentifierName;
  }

  // RegExpIdentifierName ::
  //   RegExpIdentifierStart
  //   RegExpIdentifierName RegExpIdentifierPart
  private parseRegExpIdentifierName(): string {
    let buffer = '';
    let check = isIdentifierStart;
    while (this.position < this.source.length) {
      const c = this.source[this.position];
      const code = c.charCodeAt(0);
      if (c === '\\') {
        this.position += 1;
        const RegExpUnicodeEscapeSequence = this.scope({ UnicodeMode: true }, () => this.maybeParseRegExpUnicodeEscapeSequence());
        if (!RegExpUnicodeEscapeSequence) {
          this.raise(Throw.SyntaxError('Invalid unicode escape'));
        }
        const raw = String.fromCodePoint(CharacterValue(RegExpUnicodeEscapeSequence));
        // EE: It is a Syntax Error if the CharacterValue of RegExpUnicodeEscapeSequence is not the numeric value of some code point matched by the IdentifierStartChar lexical grammar production.
        // EE: It is a Syntax Error if the CharacterValue of RegExpUnicodeEscapeSequence is not the numeric value of some code point matched by the IdentifierPartChar lexical grammar production.
        // EE: It is a Syntax Error if the RegExpIdentifierCodePoint of RegExpIdentifierPart is not matched by the UnicodeIDContinue lexical grammar production.
        if (!check(raw)) {
          this.raise(Throw.SyntaxError('Invalid identifier escape'));
        }
        buffer += raw;
      } else if (isLeadingSurrogate(code)) {
        // EE: It is a Syntax Error if the RegExpIdentifierCodePoint of RegExpIdentifierStart is not matched by the UnicodeIDStart lexical grammar production.
        const lowSurrogate = this.source.charCodeAt(this.position + 1);
        if (!isTrailingSurrogate(lowSurrogate)) {
          this.raise(Throw.SyntaxError('Invalid trailing surrogate'));
        }
        const codePoint = UTF16SurrogatePairToCodePoint(code, lowSurrogate);
        const raw = String.fromCodePoint(codePoint);
        if (!check(raw)) {
          this.raise(Throw.SyntaxError('Invalid surrogate pair'));
        }
        this.position += 2;
        buffer += raw;
      } else if (check(c)) {
        buffer += c;
        this.position += 1;
      } else {
        break;
      }
      check = isIdentifierPart;
    }
    if (buffer.length === 0) {
      this.raise(Throw.SyntaxError('Invalid empty identifier'));
    }
    return buffer;
  }

  // DecimalDigits ::
  //   DecimalDigit
  //   DecimalDigits DecimalDigit
  private parseDecimalDigits(): string {
    let n = '';
    if (!isDecimalDigit(this.peek())) {
      this.raise(Throw.SyntaxError('Invalid decimal digits'));
    }
    while (isDecimalDigit(this.peek())) {
      n += this.next();
    }
    return n;
  }

  // HexEscapeSequence ::
  //   `x` HexDigit HexDigit
  private parseHexEscapeSequence(): ParseNode.RegExp.HexEscapeSequence {
    this.expect('x');
    const HexDigit_a = this.next();
    if (!isHexDigit(HexDigit_a)) {
      this.raise(Throw.SyntaxError('Not a hex digit'));
    }
    const HexDigit_b = this.next();
    if (!isHexDigit(HexDigit_b)) {
      this.raise(Throw.SyntaxError('Not a hex digit'));
    }
    return {
      type: 'HexEscapeSequence',
      HexDigit_a,
      HexDigit_b,
    };
  }

  private scanHex(length: number) {
    if (length === 0) {
      this.raise(Throw.SyntaxError('Invalid code point'));
    }
    let n = 0;
    let oldN = 0;
    for (let i = 0; i < length; i += 1) {
      const c = this.source[this.position];
      if (isHexDigit(c)) {
        this.position += 1;
        oldN = n;
        n = (n << 4) | Number.parseInt(c, 16);
        if (oldN > n) {
          // overflow
          this.raise(Throw.SyntaxError('Invalid hex digit'));
        }
      } else {
        this.raise(Throw.SyntaxError('Invalid hex digit'));
      }
    }
    return n;
  }

  // RegExpUnicodeEscapeSequence ::
  //   [+U] `u` HexLeadSurrogate `\u` HexTrailSurrogate
  //   [+U] `u` HexLeadSurrogate
  //   [+U] `u` HexTrailSurrogate
  //   [+U] `u` HexNonSurrogate
  //   [~U] `u` Hex4Digits
  //   [+U] `u{` CodePoint `}`
  private maybeParseRegExpUnicodeEscapeSequence(): ParseNode.RegExp.RegExpUnicodeEscapeSequence | undefined {
    const start = this.position;
    if (!this.eat('u')) {
      this.position = start;
      return undefined;
    }
    if (this.inUnicodeMode && this.eat('{')) {
      const end = this.source.indexOf('}' as Character, this.position);
      if (end === -1) {
        this.raise(Throw.SyntaxError('Invalid code point'));
      }
      const code = this.scanHex(end - this.position);
      if (code > 0x10FFFF) {
        this.raise(Throw.SyntaxError('Invalid code point'));
      }
      this.position += 1;
      return {
        type: 'RegExpUnicodeEscapeSequence',
        CodePoint: code,
      };
    }
    let lead;
    try {
      lead = this.scanHex(4);
    } catch {
      this.position = start;
      return undefined;
    }
    if (this.inUnicodeMode && isLeadingSurrogate(lead)) {
      const back = this.position;
      if (this.eat('\\u')) {
        let trail;
        try {
          trail = this.scanHex(4);
          if (isTrailingSurrogate(trail)) {
            return {
              type: 'RegExpUnicodeEscapeSequence',
              HexLeadSurrogate: lead,
              HexTrailSurrogate: trail,
            };
          }
        } catch {
        }
        this.position = back;
      }
      return {
        type: 'RegExpUnicodeEscapeSequence',
        HexLeadSurrogate: lead,
      };
    }
    return {
      type: 'RegExpUnicodeEscapeSequence',
      Hex4Digits: lead,
    };
  }

  //  ClassSetExpression ::
  //    ClassUnion
  //    ClassIntersection
  //    ClassSubtraction
  private parseClassSetExpression(): ParseNode.RegExp.ClassSetExpression {
    Assert(this.inUnicodeSetMode);

    const oldPos = this.position;
    const left = this.maybeParseClassSetCharacter();
    const peek2 = this.peek(2);
    // ClassUnion :: ClassSetRange
    if (left !== undefined && peek2 !== '--' && peek2[0] === '-') {
      this.position = oldPos;
      return this.parseClassUnion();
    }
    // ClassUnion :: ClassSetOperand ...
    // ClassIntersection :: ClassSetOperand ...
    // ClassSubtraction :: ClassSetOperand ...
    const leftReparsed = this.parseClassSetOperand(left);
    if (this.eat('&&')) {
      return this.parseClassIntersectionOrSubtraction('&&', leftReparsed);
    }
    if (this.eat('--')) {
      return this.parseClassIntersectionOrSubtraction('--', leftReparsed);
    }
    return this.parseClassUnion(leftReparsed);
  }

  private parseClassUnion(operand?: ParseNode.RegExp.ClassSetOperand): ParseNode.RegExp.ClassUnion {
    const union: Array<ParseNode.RegExp.ClassSetOperand | ParseNode.RegExp.ClassSetRange> = operand ? [operand] : [];
    while (true) {
      const charPos = this.position;
      const char = this.maybeParseClassSetCharacter();
      if (char !== undefined) {
        // ClassSetRange
        if (this.eat('-')) {
          const char2 = this.maybeParseClassSetCharacter();
          if (char2 === undefined) {
            this.raise(Throw.SyntaxError('Unterminated range'));
          }
          // EE: It is a Syntax Error if the CharacterValue of the first ClassSetCharacter is strictly greater than the CharacterValue of the second ClassSetCharacter.
          if (CharacterValue(char) > CharacterValue(char2)) {
            this.raise(Throw.SyntaxError('Invalid range: $1 is bigger than $2', String.fromCodePoint(CharacterValue(char)), String.fromCodePoint(CharacterValue(char2))), charPos);
          }
          union.push({ type: 'ClassSetRange', left: char, right: char2 });
          continue;
        }
        // ClassSetCharacter
        union.push({ type: 'ClassSetOperand', production: 'ClassSetCharacter', ClassSetCharacter: char });
      } else if (this.peek() === '\\' || this.peek() === '[') {
        // NestedClass or ClassStringDisjunction
        union.push(this.parseClassSetOperand());
      } else {
        break;
      }
    }
    return { type: 'ClassUnion', union };
  }

  private parseClassIntersectionOrSubtraction(type: '&&' | '--', operand?: ParseNode.RegExp.ClassSetOperand): ParseNode.RegExp.ClassIntersection | ParseNode.RegExp.ClassSubtraction {
    const tokens = operand ? [operand] : [];
    while (true) {
      tokens.push(this.parseClassSetOperand());
      if (this.eat(type)) {
        continue;
      }
      break;
    }
    Assert(tokens.length >= 2);
    return { type: type === '&&' ? 'ClassIntersection' : 'ClassSubtraction', operands: tokens };
  }

  private parseClassSetOperand(left?: ParseNode.RegExp.ClassSetCharacter): ParseNode.RegExp.ClassSetOperand {
    Assert(this.inUnicodeSetMode);
    if (left !== undefined) {
      return { type: 'ClassSetOperand', production: 'ClassSetCharacter', ClassSetCharacter: left };
    }
    // ClassSetOperand :: NestedClass :: [ [lookahead ≠ ^] ClassContents[+UnicodeMode, +UnicodeSetsMode] ]
    // ClassSetOperand :: NestedClass :: [^ ClassContents[+UnicodeMode, +UnicodeSetsMode] ]
    if (this.eat('[')) {
      const invertPos = this.position;
      const invert = this.eat('^');
      const ClassContents = this.scope(
        { UnicodeMode: true, UnicodeSetsMode: true },
        () => this.parseClassContents(),
      );
      // NestedClass :: [^ ClassContents ]
      // EE: It is a Syntax Error if MayContainStrings of the ClassContents is true.
      if (invert && MayContainStrings(ClassContents)) {
        this.raise(Throw.SyntaxError('This class cannot be inverted'), invertPos);
      }
      this.expect(']');
      return {
        type: 'ClassSetOperand',
        production: 'NestedClass',
        NestedClass: {
          type: 'NestedClass', production: 'ClassContents', invert, ClassContents,
        },
      };
    }
    if (this.eat('\\')) {
      // ClassSetOperand :: ClassStringDisjunction :: \q{ ClassStringDisjunctionContents }
      if (this.eat('q')) {
        this.expect('{');
        const ClassStringDisjunction = this.parseClassStringDisjunctionContents();
        this.expect('}');
        return {
          type: 'ClassSetOperand',
          production: 'ClassStringDisjunction',
          ClassStringDisjunction,
        };
      }
      // ClassSetOperand :: NestedClass :: \ CharacterClassEscape[+UnicodeMode]
      const escape = this.scope(
        { UnicodeMode: true },
        () => this.maybeParseCharacterClassEscape(),
      );
      if (!escape) {
        this.raise(Throw.SyntaxError('Expect a CharacterClassEscape but $1 found', this.peek()));
      }
      return {
        type: 'ClassSetOperand',
        production: 'NestedClass',
        NestedClass: { type: 'NestedClass', production: 'CharacterClassEscape', CharacterClassEscape: escape },
      };
    }
    const ClassSetCharacter = this.maybeParseClassSetCharacter();
    if (!ClassSetCharacter) {
      this.raise(Throw.SyntaxError('Unexpected $1', this.peek()));
    }
    return { type: 'ClassSetOperand', production: 'ClassSetCharacter', ClassSetCharacter };
  }

  //  ClassSetCharacter ::
  //    [lookahead ∉ ClassSetReservedDoublePunctuator] SourceCharacter but not ClassSetSyntaxCharacter
  //    \ CharacterEscape[+UnicodeMode]
  //    \ ClassSetReservedPunctuator
  //    \b
  private maybeParseClassSetCharacter(): ParseNode.RegExp.ClassSetCharacter | undefined {
    Assert(this.inUnicodeSetMode);
    const nextTwo = this.peek(2);
    // ClassSetCharacter :: \b
    if (nextTwo === '\\b') {
      this.position += 2;
      return { type: 'ClassSetCharacter', production: 'UnicodeCharacter', UnicodeCharacter: '\\b' as UnicodeCharacter };
    }

    // ClassSetCharacter :: [lookahead ∉ ClassSetReservedDoublePunctuator] SourceCharacter but not ClassSetSyntaxCharacter
    if (
      // [lookahead ∉ ClassSetReservedDoublePunctuator]
      !'&& !! ## $$ %% ** ++ ,, .. :: ;; << == >> ?? @@ ^^ `` ~~'.split(' ').includes(nextTwo)
      // and not ClassSetSyntaxCharacter
      && !'( ) [ ] { } / - \\ |'.split(' ').includes(nextTwo[0])
    ) {
      // parse SourceCharacter
      return { type: 'ClassSetCharacter', production: 'UnicodeCharacter', UnicodeCharacter: this.parseSourceCharacter() as UnicodeCharacter };
    }

    // all production left requires a \ at the beginning
    if (nextTwo[0] !== '\\') {
      return undefined;
    }

    // \ ClassSetReservedPunctuator
    if ('& - ! # % , : ; < = > @ ` ~'.split(' ').includes(nextTwo[1])) {
      this.position += 2;
      return { type: 'ClassSetCharacter', production: 'UnicodeCharacter', UnicodeCharacter: nextTwo[1] as UnicodeCharacter };
    }

    // anything that can start a Character Escape
    if ('fnrtvc0xu/^$\\.*+?()[]{}|'.includes(nextTwo[1])) {
      this.position += 1;
      return { type: 'ClassSetCharacter', production: 'CharacterEscape', CharacterEscape: this.scope({ UnicodeMode: true }, () => this.parseCharacterEscape()) };
    }
    return undefined;
  }

  // ClassStringDisjunctionContents is a list of ClassString that separated by |.
  private parseClassStringDisjunctionContents(): ParseNode.RegExp.ClassStringDisjunction {
    const parsed: ParseNode.RegExp.ClassSetCharacter[][] = [];
    let current: ParseNode.RegExp.ClassSetCharacter[] = [];
    while (true) {
      const parse = this.maybeParseClassSetCharacter();
      if (parse) {
        current.push(parse);
      } else if (this.eat('|')) {
        parsed.push(current);
        current = [];
      } else {
        parsed.push(current);
        break;
      }
    }
    return { type: 'ClassStringDisjunction', ClassString: parsed };
  }
}

/** https://tc39.es/ecma262/#sec-static-semantics-maycontainstrings */
function MayContainStrings(node: ParseNode.RegExp.UnicodePropertyValueExpression | ParseNode.RegExp.ClassContents | ParseNode.RegExp.ClassSetExpression | ParseNode.RegExp.ClassSetOperand | ParseNode.RegExp.ClassSetRange | ParseNode.RegExp.NestedClass): boolean {
  switch (node.type) {
    case 'ClassContents':
      if (node.production === 'ClassSetExpression') {
        return MayContainStrings(node.ClassSetExpression);
      }
      return false;
    case 'UnicodePropertyValueExpression':
      if (node.production === 'Lone') {
        if (node.LoneUnicodePropertyNameOrValue in Table71_BinaryPropertyOfStrings) {
          return true;
        }
      }
      return false;
    case 'ClassUnion':
      return node.union.some(MayContainStrings);
    case 'ClassIntersection':
      return node.operands.some(MayContainStrings);
    case 'ClassSubtraction':
      return node.operands.some(MayContainStrings);
    case 'ClassSetRange':
      return false;
    case 'ClassSetOperand':
      if (node.production === 'ClassSetCharacter') {
        return false;
      } else if (node.production === 'NestedClass') {
        return MayContainStrings(node.NestedClass);
      } else if (node.production === 'ClassStringDisjunction') {
        return node.ClassStringDisjunction.ClassString.some((x) => x.length !== 1);
      }
      throw OutOfRange.exhaustive(node);
    case 'NestedClass':
      if (node.production === 'CharacterClassEscape') {
        if (node.CharacterClassEscape.production !== 'p') {
          return false;
        }
        return MayContainStrings(node.CharacterClassEscape.UnicodePropertyValueExpression);
      } else if (node.production === 'ClassContents') {
        return MayContainStrings(node.ClassContents);
      }
      throw OutOfRange.exhaustive(node);
    default:
      throw OutOfRange.exhaustive(node);
  }
}
