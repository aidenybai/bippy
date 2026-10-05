import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { UTF16SurrogatePairToCodePoint } from './all.mts';
import { Unicode, type CodePoint } from '#self';

export type CharacterValueAcceptNode =
  | ParseNode.RegExp.CharacterEscape
  | ParseNode.RegExp.RegExpUnicodeEscapeSequence
  | ParseNode.RegExp.ClassAtom
  | ParseNode.RegExp.ClassEscape
  | ParseNode.RegExp.ClassSetCharacter;

/** https://tc39.es/ecma262/#sec-patterns-static-semantics-character-value */
export function CharacterValue(node: CharacterValueAcceptNode): CodePoint {
  switch (node.type) {
    case 'CharacterEscape':
      switch (node.production) {
        case 'ControlEscape':
          switch (node.ControlEscape) {
            case 't':
              return 0x0009 as CodePoint;
            case 'n':
              return 0x000A as CodePoint;
            case 'v':
              return 0x000B as CodePoint;
            case 'f':
              return 0x000C as CodePoint;
            case 'r':
              return 0x000D as CodePoint;
            default:
              throw OutOfRange.exhaustive(node.ControlEscape);
          }
        case 'AsciiLetter': {
          // 1. Let ch be the code point matched by ControlLetter.
          const ch = node.AsciiLetter;
          // 2. Let i be ch's code point value.
          const i = ch.codePointAt(0)!;
          // 3. Return the remainder of dividing i by 32.
          return i % 32 as CodePoint;
        }
        case 'HexEscapeSequence':
          // 1. Return the numeric value of the code unit that is the SV of HexEscapeSequence.
          return Number.parseInt(`${node.HexEscapeSequence.HexDigit_a}${node.HexEscapeSequence.HexDigit_b}`, 16) as CodePoint;
        case 'RegExpUnicodeEscapeSequence':
          return CharacterValue(node.RegExpUnicodeEscapeSequence);
        case '0':
          // 1. Return the code point value of U+0000 (NULL).
          return 0x0000 as CodePoint;
        case 'IdentityEscape': {
          // 1. Let ch be the code point matched by IdentityEscape.
          const ch = node.IdentityEscape.codePointAt(0)!;
          // 2. Return the code point value of ch.
          return ch as CodePoint;
        }
        default:
          throw OutOfRange.exhaustive(node);
      }
    case 'RegExpUnicodeEscapeSequence':
      switch (true) {
        case 'Hex4Digits' in node:
          return node.Hex4Digits as CodePoint;
        case 'CodePoint' in node:
          return node.CodePoint as CodePoint;
        case 'HexTrailSurrogate' in node:
          return UTF16SurrogatePairToCodePoint(node.HexLeadSurrogate!, node.HexTrailSurrogate!);
        case 'HexLeadSurrogate' in node:
          return node.HexLeadSurrogate as CodePoint;
        default:
          throw OutOfRange.nonExhaustive(node);
      }
    case 'ClassAtom':
      switch (node.production) {
        case '-':
          // 1. Return the code point value of U+002D (HYPHEN-MINUS).
          return 0x002D as CodePoint;
        case 'SourceCharacter': {
          // 1. Let ch be the code point matched by SourceCharacter.
          const ch = node.SourceCharacter.codePointAt(0)!;
          // 2. Return ch.
          return ch as CodePoint;
        }
        case 'ClassEscape':
          return CharacterValue(node.ClassEscape);
        default:
          throw OutOfRange.exhaustive(node);
      }
    case 'ClassEscape':
      switch (node.production) {
        case 'b':
          // 1. Return the code point value of U+0008 (BACKSPACE).
          return 0x0008 as CodePoint;
        case '-':
          // 1. Return the code point value of U+002D (HYPHEN-MINUS).
          return 0x002D as CodePoint;
        case 'CharacterEscape':
          return CharacterValue(node.CharacterEscape);
        case 'CharacterClassEscape':
          throw OutOfRange.nonExhaustive(node);
        default:
          throw OutOfRange.exhaustive(node);
      }
    case 'ClassSetCharacter': {
      if (node.production === 'CharacterEscape') {
        return CharacterValue(node.CharacterEscape);
      } else {
        return Unicode.toCodePoint(node.UnicodeCharacter);
      }
    }
    default:
      throw OutOfRange.exhaustive(node);
  }
}
