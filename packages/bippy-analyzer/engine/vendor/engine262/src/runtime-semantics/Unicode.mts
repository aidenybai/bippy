import unicodeCaseFoldingCommon from '@unicode/unicode-17.0.0/Case_Folding/C/symbols.js';
import unicodeCaseFoldingSimple from '@unicode/unicode-17.0.0/Case_Folding/S/symbols.js';
// @ts-ignore
import UnicodeSets from '../unicode/CodePointProperties.json' with { type: 'json' };
// @ts-ignore
import SequenceProperties from '../unicode/SequenceProperties.json' with { type: 'json' };
import { Assert, Canonicalize, type RegExpRecord } from '#self';

export const isLeadingSurrogate = (cp: number) => cp >= 0xD800 && cp <= 0xDBFF;
export const isTrailingSurrogate = (cp: number) => cp >= 0xDC00 && cp <= 0xDFFF;
/** https://tc39.es/ecma262/#table-nonbinary-unicode-properties */
export const Table69_NonbinaryUnicodeProperties = {
  General_Category: 'General_Category',
  gc: 'General_Category',
  Script: 'Script',
  sc: 'Script',
  Script_Extensions: 'Script_Extensions',
  scx: 'Script_Extensions',
} as const;
Object.setPrototypeOf(Table69_NonbinaryUnicodeProperties, null);
export type Table69_NonbinaryUnicodePropertiesCanonicalized = typeof Table69_NonbinaryUnicodeProperties[keyof typeof Table69_NonbinaryUnicodeProperties];

/** https://tc39.es/ecma262/#table-binary-unicode-properties */
export const Table70_BinaryUnicodeProperties = {
  ASCII: 'ASCII',
  ASCII_Hex_Digit: 'ASCII_Hex_Digit',
  AHex: 'ASCII_Hex_Digit',
  Alphabetic: 'Alphabetic',
  Alpha: 'Alphabetic',
  Any: 'Any',
  Assigned: 'Assigned',
  Bidi_Control: 'Bidi_Control',
  Bidi_C: 'Bidi_Control',
  Bidi_Mirrored: 'Bidi_Mirrored',
  Bidi_M: 'Bidi_Mirrored',
  Case_Ignorable: 'Case_Ignorable',
  CI: 'Case_Ignorable',
  Cased: 'Cased',
  Changes_When_Casefolded: 'Changes_When_Casefolded',
  CWCF: 'Changes_When_Casefolded',
  Changes_When_Casemapped: 'Changes_When_Casemapped',
  CWCM: 'Changes_When_Casemapped',
  Changes_When_Lowercased: 'Changes_When_Lowercased',
  CWL: 'Changes_When_Lowercased',
  Changes_When_NFKC_Casefolded: 'Changes_When_NFKC_Casefolded',
  CWKCF: 'Changes_When_NFKC_Casefolded',
  Changes_When_Titlecased: 'Changes_When_Titlecased',
  CWT: 'Changes_When_Titlecased',
  Changes_When_Uppercased: 'Changes_When_Uppercased',
  CWU: 'Changes_When_Uppercased',
  Dash: 'Dash',
  Default_Ignorable_Code_Point: 'Default_Ignorable_Code_Point',
  DI: 'Default_Ignorable_Code_Point',
  Deprecated: 'Deprecated',
  Dep: 'Deprecated',
  Diacritic: 'Diacritic',
  Dia: 'Diacritic',
  Emoji: 'Emoji',
  Emoji_Component: 'Emoji_Component',
  EComp: 'Emoji_Component',
  Emoji_Modifier: 'Emoji_Modifier',
  EMod: 'Emoji_Modifier',
  Emoji_Modifier_Base: 'Emoji_Modifier_Base',
  EBase: 'Emoji_Modifier_Base',
  Emoji_Presentation: 'Emoji_Presentation',
  EPres: 'Emoji_Presentation',
  Extended_Pictographic: 'Extended_Pictographic',
  ExtPict: 'Extended_Pictographic',
  Extender: 'Extender',
  Ext: 'Extender',
  Grapheme_Base: 'Grapheme_Base',
  Gr_Base: 'Grapheme_Base',
  Grapheme_Extend: 'Grapheme_Extend',
  Gr_Ext: 'Grapheme_Extend',
  Hex_Digit: 'Hex_Digit',
  Hex: 'Hex_Digit',
  IDS_Binary_Operator: 'IDS_Binary_Operator',
  IDSB: 'IDS_Binary_Operator',
  IDS_Trinary_Operator: 'IDS_Trinary_Operator',
  IDST: 'IDS_Trinary_Operator',
  ID_Continue: 'ID_Continue',
  IDC: 'ID_Continue',
  ID_Start: 'ID_Start',
  IDS: 'ID_Start',
  Ideographic: 'Ideographic',
  Ideo: 'Ideographic',
  Join_Control: 'Join_Control',
  Join_C: 'Join_Control',
  Logical_Order_Exception: 'Logical_Order_Exception',
  LOE: 'Logical_Order_Exception',
  Lowercase: 'Lowercase',
  Lower: 'Lowercase',
  Math: 'Math',
  Noncharacter_Code_Point: 'Noncharacter_Code_Point',
  NChar: 'Noncharacter_Code_Point',
  Pattern_Syntax: 'Pattern_Syntax',
  Pat_Syn: 'Pattern_Syntax',
  Pattern_White_Space: 'Pattern_White_Space',
  Pat_WS: 'Pattern_White_Space',
  Quotation_Mark: 'Quotation_Mark',
  QMark: 'Quotation_Mark',
  Radical: 'Radical',
  Regional_Indicator: 'Regional_Indicator',
  RI: 'Regional_Indicator',
  Sentence_Terminal: 'Sentence_Terminal',
  STerm: 'Sentence_Terminal',
  Soft_Dotted: 'Soft_Dotted',
  SD: 'Soft_Dotted',
  Terminal_Punctuation: 'Terminal_Punctuation',
  Term: 'Terminal_Punctuation',
  Unified_Ideograph: 'Unified_Ideograph',
  UIdeo: 'Unified_Ideograph',
  Uppercase: 'Uppercase',
  Upper: 'Uppercase',
  Variation_Selector: 'Variation_Selector',
  VS: 'Variation_Selector',
  White_Space: 'White_Space',
  space: 'White_Space',
  XID_Continue: 'XID_Continue',
  XIDC: 'XID_Continue',
  XID_Start: 'XID_Start',
  XIDS: 'XID_Start',
} as const;
Object.setPrototypeOf(Table70_BinaryUnicodeProperties, null);

/** https://tc39.es/ecma262/#table-binary-unicode-properties-of-strings */
export const Table71_BinaryPropertyOfStrings = {
  Basic_Emoji: 'Basic_Emoji',
  Emoji_Keycap_Sequence: 'Emoji_Keycap_Sequence',
  RGI_Emoji_Modifier_Sequence: 'RGI_Emoji_Modifier_Sequence',
  RGI_Emoji_Flag_Sequence: 'RGI_Emoji_Flag_Sequence',
  RGI_Emoji_Tag_Sequence: 'RGI_Emoji_Tag_Sequence',
  RGI_Emoji_ZWJ_Sequence: 'RGI_Emoji_ZWJ_Sequence',
  RGI_Emoji: 'RGI_Emoji',
} as const;
Object.setPrototypeOf(Table71_BinaryPropertyOfStrings, null);

const canonicalizeUnicodePropertyCache: Record<string, [excludeSet: ReadonlySet<string>, includeSet: ReadonlySet<string>]> = { __proto__: null! };
const stringPropertySetCache: Record<string, readonly ListOfCharacter[]> = {};
// TODO(unicode): methods here should be implemented based on Unicode database so we can pin Unicode version.
export const Unicode = {
  toUppercase(ch: CodePoint): ListOfCharacter {
    return String.fromCodePoint(ch).toUpperCase() as ListOfCharacter;
  },
  toCodePoint(ch: Character): CodePoint {
    return ch.codePointAt(0)! as CodePoint;
  },
  toCharacter(ch: CodePoint): UnicodeCharacter {
    return String.fromCodePoint(ch) as UnicodeCharacter;
  },
  isCharacter(ch: Character | ListOfCharacter): ch is Character {
    return ch.length === 1 || [...ch].length === 1;
  },
  toCodeUnit(ch: Character): [CodeUnit, CodeUnit?] {
    const codePoint = ch.charCodeAt(0)!;
    const codePoint2 = ch.charCodeAt(1);
    return [codePoint as CodeUnit, Number.isNaN(codePoint2) ? codePoint2 as CodeUnit : undefined];
  },
  iterateByCodePoint(x: string): UnicodeCharacter[] {
    return Array.from(x) as UnicodeCharacter[];
  },
  characterMatchPropertyValue(ch: Character | ListOfCharacter, property: Table69_NonbinaryUnicodePropertiesCanonicalized, value: string | undefined, rer: RegExpRecord | undefined) {
    if (!Unicode.isCharacter(ch)) {
      return false;
    }
    let path = value ? `${property}/${value}` : `Binary_Property/${property}`;
    const cp = ch.codePointAt(0)!;
    // https://www.unicode.org/reports/tr24/#Script_Values
    // Unknown is: Unused, private use or surrogate code points.
    if ((property === 'Script' || property === 'Script_Extensions') && (value === 'Unknown' || value === 'Zzzz')) {
      // https://www.unicode.org/faq/private_use.html
      if ((cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xF0000 && cp <= 0xFFFFD) || (cp >= 0x100000 && cp <= 0x10FFFD)) {
        return true;
      }
      // Non characters
      if ((cp >= 0xFDD0 && cp <= 0xFDEF) || cp === 0xFFFE || cp === 0xFFFF || cp.toString(16).match(/^(?:[0-9a-f]|10)fff[fe]$/i)) {
        return true;
      }
      if (isLeadingSurrogate(cp) || isTrailingSurrogate(cp)) {
        return true;
      }
      path = 'General_Category/Unassigned';
    }
    if (!(path in UnicodeSets)) {
      throw new Assert.Error(`Unicode property "${path}" not found in UnicodeSets.`);
    }
    if (rer) {
      const cacheKey = JSON.stringify([rer, path]);
      if (!canonicalizeUnicodePropertyCache[cacheKey]) {
        const excludeSet = new Set<string>();
        const includeSet = new Set<string>();
        for (const [from, to] of (UnicodeSets as Record<string, number[][]>)[path]) {
          for (let index = from; index <= to; index += 1) {
            const char = String.fromCodePoint(index) as UnicodeCharacter;
            const ch2 = Canonicalize(rer, char) as UnicodeCharacter;
            if (char !== ch2) {
              excludeSet.add(char);
              includeSet.add(ch2);
            }
          }
        }
        canonicalizeUnicodePropertyCache[cacheKey] = [excludeSet, includeSet];
      }
      const [excludeSet, includeSet] = canonicalizeUnicodePropertyCache[cacheKey];
      if (excludeSet.has(ch)) {
        return false;
      }
      if (includeSet.has(ch)) {
        return true;
      }
    }
    return !!(UnicodeSets as Record<string, number[][]>)[path].find(([from, to]) => from <= cp && cp <= to);
  },
  getStringPropertySet(property: keyof typeof Table71_BinaryPropertyOfStrings) {
    stringPropertySetCache[property] ??= SequenceProperties[property].split(',') as ListOfCharacter[];
    return stringPropertySetCache[property];
  },

  /** https://www.unicode.org/reports/tr44/#Simple_Case_Folding */
  // TODO: scf() in spec means Simple Case Folding or Simple + Common Case Folding?
  // https://github.com/tc39/ecma262/issues/3594
  // SimpleCaseFoldingMapping(ch: Character): Character {
  //   // Note: The case foldings are omitted in the data file if they are the same as the code point itself.
  //   return (unicodeCaseFoldingSimple.get(ch) || ch) as Character;
  // },
  SimpleOrCommonCaseFoldingMapping(ch: Character): Character | undefined {
    if (unicodeCaseFoldingCommon.has(ch)) {
      return unicodeCaseFoldingCommon.get(ch)! as Character;
    }
    if (unicodeCaseFoldingSimple.has(ch)) {
      return unicodeCaseFoldingSimple.get(ch)! as Character;
    }
    return ch;
  },
  iterateCharacterByCodePoint(string: Character | ListOfCharacter) {
    return string[Symbol.iterator]() as IterableIterator<Character>;
  },
  str_normalization(string: string, form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'): string {
    return string.normalize(form);
  },
  str_toLowercase(string: string): string {
    return string.toLowerCase();
  },
  str_toUppercase(string: string): string {
    return string.toUpperCase();
  },
  str_toLocaleLowercase(string: string): string {
    return string.toLocaleLowerCase();
  },
  str_toLocaleUppercase(string: string): string {
    return string.toLocaleUpperCase();
  },
};

/** https://tc39.es/ecma262/#sec-pattern-semantics */
export type BMPCharacter = string & { description: 'A code unit', length: 1 };
/** https://tc39.es/ecma262/#sec-pattern-semantics */
export type UnicodeCharacter = string & { description: 'A code point', length: 1 | 2 };
/** https://tc39.es/ecma262/#sec-pattern-semantics */
export type Character = BMPCharacter | UnicodeCharacter;
/* List of BMPCharacter (non Unicode mode) or list of CodePoint. */
export type ListOfCharacter = string & { __brand__: 'ListOfCharacter' };

/** https://developer.mozilla.org/en-US/docs/Glossary/Code_point */
export type CodePoint = number & { __brand__: 'CodePoint' };

/** https://developer.mozilla.org/en-US/docs/Glossary/Code_unit */
export type CodeUnit = number & { __brand__: 'CodeUnit' };
