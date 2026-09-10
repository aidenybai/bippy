import type { StaticRegExpValue } from "../types.js";

export const toRegExp = (value: StaticRegExpValue): RegExp | null => {
  try {
    return new RegExp(value.pattern, value.flags);
  } catch {
    return null;
  }
};

interface PatternCursor {
  readonly pattern: string;
  index: number;
}

const QUANTIFIER_PATTERN = /^\{(\d+)(?:,\d*)?\}/;

const union = (left: Set<string>, right: Set<string>): Set<string> => new Set([...left, ...right]);

const intersection = (sets: Set<string>[]): Set<string> =>
  sets.reduce((common, set) => new Set([...common].filter((character) => set.has(character))));

const skipCharacterClass = (cursor: PatternCursor): boolean => {
  cursor.index++;
  while (cursor.index < cursor.pattern.length) {
    const character = cursor.pattern[cursor.index];
    if (character === "]") {
      cursor.index++;
      return true;
    }
    cursor.index += character === "\\" ? 2 : 1;
  }
  return false;
};

const parseHex = (cursor: PatternCursor, digits: number): string | null => {
  const text = cursor.pattern.slice(cursor.index, cursor.index + digits);
  if (text.length !== digits || !/^[0-9a-fA-F]+$/.test(text)) return null;
  cursor.index += digits;
  return String.fromCodePoint(Number.parseInt(text, 16));
};

const CONTROL_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  f: "\f",
  0: "\0",
};

/** The literal an escape denotes, an empty set for a class or assertion escape, null when malformed. */
const parseEscape = (cursor: PatternCursor): Set<string> | null => {
  const escaped = cursor.pattern[cursor.index + 1];
  cursor.index += 2;
  if (escaped === undefined) return null;
  if (/[dDwWsSbB1-9]/.test(escaped)) return new Set();
  if (escaped === "k" || ((escaped === "p" || escaped === "P") && cursor.pattern[cursor.index] === "{")) {
    const end = cursor.pattern.indexOf(escaped === "k" ? ">" : "}", cursor.index);
    if (end === -1) return null;
    cursor.index = end + 1;
    return new Set();
  }
  if (escaped === "c") {
    cursor.index++;
    return new Set();
  }
  if (escaped === "x") {
    const character = parseHex(cursor, 2);
    return character === null ? null : new Set([character]);
  }
  if (escaped === "u") {
    if (cursor.pattern[cursor.index] === "{") {
      const end = cursor.pattern.indexOf("}", cursor.index);
      if (end === -1) return null;
      const codePoint = Number.parseInt(cursor.pattern.slice(cursor.index + 1, end), 16);
      cursor.index = end + 1;
      return Number.isNaN(codePoint) ? null : new Set([String.fromCodePoint(codePoint)]);
    }
    const character = parseHex(cursor, 4);
    return character === null ? null : new Set([character]);
  }
  const control = CONTROL_ESCAPES[escaped];
  return new Set([control ?? escaped]);
};

/** Whether the quantifier at the cursor (if any) lets its atom match zero times; consumes it. */
const parseQuantifier = (cursor: PatternCursor): boolean => {
  const character = cursor.pattern[cursor.index];
  let isOptional = false;
  if (character === "?" || character === "*") {
    isOptional = true;
    cursor.index++;
  } else if (character === "+") {
    cursor.index++;
  } else if (character === "{") {
    const quantifier = QUANTIFIER_PATTERN.exec(cursor.pattern.slice(cursor.index));
    if (!quantifier) return false;
    isOptional = Number(quantifier[1]) === 0;
    cursor.index += quantifier[0].length;
  } else {
    return false;
  }
  if (cursor.pattern[cursor.index] === "?") cursor.index++;
  return isOptional;
};

const parseGroup = (cursor: PatternCursor): Set<string> | null => {
  cursor.index++;
  let isLookaround = false;
  if (cursor.pattern[cursor.index] === "?") {
    const modifier = cursor.pattern.slice(cursor.index + 1, cursor.index + 3);
    if (modifier.startsWith(":")) cursor.index += 2;
    else if (modifier.startsWith("=") || modifier.startsWith("!")) {
      isLookaround = true;
      cursor.index += 2;
    } else if (modifier === "<=" || modifier === "<!") {
      isLookaround = true;
      cursor.index += 3;
    } else if (modifier.startsWith("<")) {
      const end = cursor.pattern.indexOf(">", cursor.index);
      if (end === -1) return null;
      cursor.index = end + 1;
    } else return null;
  }
  const inner = parseDisjunction(cursor);
  if (inner === null || cursor.pattern[cursor.index] !== ")") return null;
  cursor.index++;
  return isLookaround ? new Set() : inner;
};

const parseSequence = (cursor: PatternCursor): Set<string> | null => {
  let required = new Set<string>();
  while (cursor.index < cursor.pattern.length) {
    const character = cursor.pattern[cursor.index];
    if (character === "|" || character === ")") break;
    let atom: Set<string> | null;
    if (character === "(") atom = parseGroup(cursor);
    else if (character === "[") atom = skipCharacterClass(cursor) ? new Set() : null;
    else if (character === "\\") atom = parseEscape(cursor);
    else {
      cursor.index++;
      atom = character === "." || character === "^" || character === "$" ? new Set() : new Set([character]);
    }
    if (atom === null) return null;
    if (!parseQuantifier(cursor)) required = union(required, atom);
  }
  return required;
};

const parseDisjunction = (cursor: PatternCursor): Set<string> | null => {
  const alternatives: Set<string>[] = [];
  for (;;) {
    const sequence = parseSequence(cursor);
    if (sequence === null) return null;
    alternatives.push(sequence);
    if (cursor.pattern[cursor.index] !== "|") return intersection(alternatives);
    cursor.index++;
  }
};

/**
 * Literal characters every match of the pattern contains, or null when the
 * pattern is not understood. A character class, wildcard or lookaround
 * contributes nothing; an alternation only what all its arms share.
 */
export const getRequiredCharacters = (regExp: RegExp): Set<string> | null => {
  if (regExp.unicodeSets) return null;
  const cursor: PatternCursor = { pattern: regExp.source, index: 0 };
  const required = parseDisjunction(cursor);
  return required !== null && cursor.index === regExp.source.length ? required : null;
};

const isAscii = (character: string): boolean => character.charCodeAt(0) < 128;

/** `Canonicalize` for a non-Unicode ignore-case pattern: upper-case, unless that leaves the ASCII range or yields several characters. */
const canonicalize = (character: string): string => {
  const upper = character.toUpperCase();
  return upper.length !== 1 || (!isAscii(character) && isAscii(upper)) ? character : upper;
};

/**
 * Whether a string drawn from `alphabet` can match `regExp`; false only when a
 * required literal is absent. Unicode case folding (`/iu`) pairs some ASCII
 * letters with non-ASCII ones (`k` with the Kelvin sign), so it is only decided
 * while everything involved is ASCII.
 */
export const mayRegExpMatch = (regExp: RegExp, alphabet: ReadonlySet<string>): boolean => {
  const required = getRequiredCharacters(regExp);
  if (required === null) return true;
  if (!regExp.ignoreCase) return [...required].every((character) => alphabet.has(character));
  if (regExp.unicode && ![...alphabet, ...required].every(isAscii)) return true;
  const canonicalAlphabet = new Set([...alphabet].map(canonicalize));
  return [...required].every((character) => canonicalAlphabet.has(canonicalize(character)));
};

/** Whether a string drawn from `alphabet` can contain `needle`. */
export const mayContainText = (needle: string, alphabet: ReadonlySet<string>): boolean =>
  [...needle].every((character) => alphabet.has(character));
