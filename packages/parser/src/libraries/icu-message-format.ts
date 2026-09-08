import {
  getKnownObjectKeys,
  getObjectProperty,
  getTruthiness,
  isKnownString,
  listValue,
  primitiveValue,
  toJsonValue,
  unknownPrimitiveValue,
} from "../evaluate/values.js";
import type { JsonValue, StaticValue, StubRenderTools } from "../types.js";

// ICU MessageFormat over static values, following `@formatjs/icu-messageformat-parser`
// (grammar) and `intl-messageformat` (`formatToParts`/`format`). What the
// runtime decides from data the analysis does not hold is unknown; what the
// runtime rejects (missing values, non-function tag values) is an error the
// caller turns into the library's fallback.

export interface IcuLiteralElement {
  kind: "literal";
  value: string;
}

export interface IcuArgumentElement {
  kind: "argument";
  name: string;
}

export interface IcuStyledArgumentElement {
  kind: "number" | "date" | "time";
  name: string;
  style: string | null;
}

export interface IcuChoiceElement {
  kind: "select" | "plural" | "selectordinal";
  name: string;
  offset: number;
  options: Map<string, IcuElement[]>;
}

export interface IcuPoundElement {
  kind: "pound";
}

export interface IcuTagElement {
  kind: "tag";
  name: string;
  children: IcuElement[];
}

export type IcuElement =
  | IcuLiteralElement
  | IcuArgumentElement
  | IcuStyledArgumentElement
  | IcuChoiceElement
  | IcuPoundElement
  | IcuTagElement;

export interface IcuFormatOptions {
  /** BCP 47 locale the message is formatted for; null when the running app decides it. */
  locale: string | null;
  /** Named formats (`formats.number.precise`) configured globally and per call. */
  formats: StaticValue[];
}

export interface IcuFormattedValue {
  kind: "value";
  value: StaticValue;
}

/** The runtime throws while formatting, so the library substitutes its fallback. */
export interface IcuFormatError {
  kind: "error";
  reason: string;
}

export interface IcuFormatUnknown {
  kind: "unknown";
  reason: string;
}

export type IcuFormatResult = IcuFormattedValue | IcuFormatError | IcuFormatUnknown;

interface Cursor {
  text: string;
  index: number;
}

interface IcuLiteralPart {
  kind: "literal";
  value: string;
}

interface IcuNodePart {
  kind: "node";
  value: StaticValue;
}

/** Text whose content the runtime decides (an unknown string or number interpolated into literals). */
interface IcuUnknownTextPart {
  kind: "unknown-text";
  reason: string;
}

type IcuPart = IcuLiteralPart | IcuNodePart | IcuUnknownTextPart;

interface IcuFailure {
  failure: "error" | "unknown";
  reason: string;
}

const IDENTIFIER_PATTERN = /^[^\p{White_Space}\p{Pattern_Syntax}]+/u;
const TAG_NAME_PATTERN = /^[a-zA-Z][\w:.-]*/;
const WHITESPACE_PATTERN = /^\p{White_Space}+/u;
const DIGITS_PATTERN = /^\d+/;
const PLAIN_MESSAGE_PATTERN = /'[{}<#|']|<|\{/;

const DEFAULT_NUMBER_FORMATS: Record<string, Record<string, string>> = {
  currency: { style: "currency" },
  percent: { style: "percent" },
};

const isPluralKind = (kind: string | null): boolean =>
  kind === "plural" || kind === "selectordinal";

const isAlpha = (character: string | undefined): boolean =>
  character !== undefined && /[a-zA-Z]/.test(character);

const peek = (cursor: Cursor, offset = 0): string | undefined => cursor.text[cursor.index + offset];

const skipWhitespace = (cursor: Cursor): void => {
  const match = WHITESPACE_PATTERN.exec(cursor.text.slice(cursor.index));
  if (match) cursor.index += match[0].length;
};

const readPattern = (cursor: Cursor, pattern: RegExp): string | null => {
  const match = pattern.exec(cursor.text.slice(cursor.index));
  if (!match) return null;
  cursor.index += match[0].length;
  return match[0];
};

const readExpected = (cursor: Cursor, expected: string): boolean => {
  if (!cursor.text.startsWith(expected, cursor.index)) return false;
  cursor.index += expected.length;
  return true;
};

const readQuoted = (cursor: Cursor, parentKind: string | null): string | null => {
  if (peek(cursor) !== "'") return null;
  const next = peek(cursor, 1);
  if (next === "'") {
    cursor.index += 2;
    return "'";
  }
  const startsQuote =
    next === "{" ||
    next === "}" ||
    next === "<" ||
    next === ">" ||
    (next === "#" && isPluralKind(parentKind));
  if (!startsQuote) return null;
  cursor.index += 1;
  let quoted = "";
  while (cursor.index < cursor.text.length) {
    const character = cursor.text[cursor.index];
    if (character === "'") {
      if (peek(cursor, 1) === "'") {
        quoted += "'";
        cursor.index += 2;
        continue;
      }
      cursor.index += 1;
      return quoted;
    }
    quoted += character;
    cursor.index += 1;
  }
  return quoted;
};

const readLiteral = (cursor: Cursor, nesting: number, parentKind: string | null): string => {
  let literal = "";
  while (cursor.index < cursor.text.length) {
    const quoted = readQuoted(cursor, parentKind);
    if (quoted !== null) {
      literal += quoted;
      continue;
    }
    const character = cursor.text[cursor.index];
    if (character === "{" || (character === "}" && nesting > 0)) break;
    if (character === "#" && isPluralKind(parentKind)) break;
    if (character === "<") {
      const next = peek(cursor, 1);
      if (isAlpha(next) || next === "/") break;
    }
    literal += character;
    cursor.index += 1;
  }
  return literal;
};

const readTag = (
  cursor: Cursor,
  nesting: number,
  parentKind: string | null,
): IcuTagElement | null => {
  cursor.index += 1;
  const name = readPattern(cursor, TAG_NAME_PATTERN);
  if (name === null) return null;
  skipWhitespace(cursor);
  if (readExpected(cursor, "/>")) return { kind: "tag", name, children: [] };
  if (!readExpected(cursor, ">")) return null;
  const children = readElements(cursor, nesting, parentKind, true);
  if (children === null) return null;
  if (!readExpected(cursor, `</${name}`)) return null;
  skipWhitespace(cursor);
  return readExpected(cursor, ">") ? { kind: "tag", name, children } : null;
};

const readChoiceOptions = (
  cursor: Cursor,
  nesting: number,
  kind: IcuChoiceElement["kind"],
): Map<string, IcuElement[]> | null => {
  const options = new Map<string, IcuElement[]>();
  while (true) {
    skipWhitespace(cursor);
    if (peek(cursor) === "}") break;
    const key =
      peek(cursor) === "="
        ? (() => {
            cursor.index += 1;
            const digits = readPattern(cursor, DIGITS_PATTERN);
            return digits === null ? null : `=${digits}`;
          })()
        : readPattern(cursor, IDENTIFIER_PATTERN);
    if (key === null) return null;
    skipWhitespace(cursor);
    if (!readExpected(cursor, "{")) return null;
    const value = readElements(cursor, nesting + 1, kind, false);
    if (value === null || !readExpected(cursor, "}")) return null;
    options.set(key, value);
  }
  return options.size > 0 && options.has("other") ? options : null;
};

const readStyle = (cursor: Cursor): string | null => {
  let depth = 0;
  const start = cursor.index;
  while (cursor.index < cursor.text.length) {
    const character = cursor.text[cursor.index];
    if (character === "'") {
      cursor.index += 1;
      const closing = cursor.text.indexOf("'", cursor.index);
      if (closing === -1) return null;
      cursor.index = closing + 1;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      if (depth === 0) break;
      depth -= 1;
    }
    cursor.index += 1;
  }
  const style = cursor.text.slice(start, cursor.index).trim();
  return style.length > 0 ? style : null;
};

const readArgument = (cursor: Cursor, nesting: number): IcuElement | null => {
  cursor.index += 1;
  skipWhitespace(cursor);
  const name = readPattern(cursor, IDENTIFIER_PATTERN);
  if (name === null) return null;
  skipWhitespace(cursor);
  if (readExpected(cursor, "}")) return { kind: "argument", name };
  if (!readExpected(cursor, ",")) return null;
  skipWhitespace(cursor);
  const kind = readPattern(cursor, IDENTIFIER_PATTERN);
  skipWhitespace(cursor);
  switch (kind) {
    case "number":
    case "date":
    case "time": {
      if (readExpected(cursor, "}")) return { kind, name, style: null };
      if (!readExpected(cursor, ",")) return null;
      skipWhitespace(cursor);
      const style = readStyle(cursor);
      return readExpected(cursor, "}") ? { kind, name, style } : null;
    }
    case "select":
    case "plural":
    case "selectordinal": {
      if (!readExpected(cursor, ",")) return null;
      skipWhitespace(cursor);
      let offset = 0;
      if (kind !== "select" && readExpected(cursor, "offset:")) {
        skipWhitespace(cursor);
        const digits = readPattern(cursor, DIGITS_PATTERN);
        if (digits === null) return null;
        offset = Number(digits);
      }
      const options = readChoiceOptions(cursor, nesting, kind);
      if (options === null || !readExpected(cursor, "}")) return null;
      return { kind, name, offset, options };
    }
    default:
      return null;
  }
};

const readElements = (
  cursor: Cursor,
  nesting: number,
  parentKind: string | null,
  isInsideTag: boolean,
): IcuElement[] | null => {
  const elements: IcuElement[] = [];
  while (cursor.index < cursor.text.length) {
    const character = cursor.text[cursor.index];
    if (character === "{") {
      const argument = readArgument(cursor, nesting);
      if (argument === null) return null;
      elements.push(argument);
    } else if (character === "}" && nesting > 0) {
      break;
    } else if (character === "#" && isPluralKind(parentKind)) {
      cursor.index += 1;
      elements.push({ kind: "pound" });
    } else if (character === "<" && peek(cursor, 1) === "/") {
      if (isInsideTag) break;
      return null;
    } else if (character === "<" && isAlpha(peek(cursor, 1))) {
      const tag = readTag(cursor, nesting, parentKind);
      if (tag === null) return null;
      elements.push(tag);
    } else {
      elements.push({ kind: "literal", value: readLiteral(cursor, nesting, parentKind) });
    }
  }
  return elements;
};

/** The message's AST, or null when it does not parse (or uses syntax this parser does not cover). */
export const parseIcuMessage = (message: string): IcuElement[] | null => {
  const cursor: Cursor = { text: message, index: 0 };
  const elements = readElements(cursor, 0, null, false);
  return elements !== null && cursor.index === message.length ? elements : null;
};

const isFailure = <T>(result: T | IcuFailure): result is IcuFailure =>
  typeof result === "object" && result !== null && "failure" in result;

const failure = (kind: IcuFailure["failure"], reason: string): IcuFailure => ({
  failure: kind,
  reason,
});

const isTextPart = (part: IcuPart): part is IcuLiteralPart | IcuUnknownTextPart =>
  part.kind !== "node";

const mergeTextParts = (
  last: IcuLiteralPart | IcuUnknownTextPart,
  part: IcuLiteralPart | IcuUnknownTextPart,
): IcuPart => {
  if (last.kind === "unknown-text") return last;
  if (part.kind === "unknown-text") return part;
  return { kind: "literal", value: last.value + part.value };
};

const mergeLiterals = (parts: IcuPart[]): IcuPart[] => {
  const merged: IcuPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last !== undefined && isTextPart(last) && isTextPart(part)) {
      merged[merged.length - 1] = mergeTextParts(last, part);
    } else {
      merged.push(part);
    }
  }
  return merged;
};

const partToValue = (part: IcuPart): StaticValue => {
  switch (part.kind) {
    case "literal":
      return primitiveValue(part.value);
    case "unknown-text":
      return unknownPrimitiveValue("string", part.reason);
    case "node":
      return part.value;
  }
};

const partOf = (value: StaticValue): IcuPart => {
  if (isKnownString(value)) return { kind: "literal", value: value.value };
  if (value.kind === "unknown-primitive" && value.primitiveType === "string") {
    return { kind: "unknown-text", reason: value.reason };
  }
  return { kind: "node", value };
};

const lookupValue = (values: StaticValue, name: string): StaticValue | IcuFailure => {
  if (values.kind !== "object") {
    return values.kind === "primitive"
      ? failure("error", `no value for "${name}"`)
      : failure("unknown", `interpolation values are ${values.kind}`);
  }
  const keys = getKnownObjectKeys(values);
  if (keys === null) return failure("unknown", "interpolation values include a dynamic spread");
  if (!keys.includes(name)) return failure("error", `no value for "${name}"`);
  return getObjectProperty(values, name);
};

const knownNumber = (value: StaticValue): number | IcuFailure => {
  if (value.kind === "primitive" && typeof value.value === "number") return value.value;
  if (value.kind === "primitive" && typeof value.value === "bigint") return Number(value.value);
  return failure("unknown", `numeric value is ${value.kind}`);
};

const numberFormatOptions = (
  style: string | null,
  options: IcuFormatOptions,
): Intl.NumberFormatOptions | IcuFailure => {
  if (style === null) return {};
  if (style.startsWith("::")) return failure("unknown", "number skeletons are not modeled");
  for (const formats of options.formats) {
    if (formats.kind !== "object") {
      if (formats.kind === "primitive") continue;
      return failure("unknown", `formats are ${formats.kind}`);
    }
    const numberFormats = getObjectProperty(formats, "number");
    if (numberFormats.kind !== "object") continue;
    const named = getObjectProperty(numberFormats, style);
    if (named.kind === "primitive" && named.value === undefined) continue;
    const json = toJsonValue(named);
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      return failure("unknown", `number format "${style}" is not statically known`);
    }
    return Object.assign<Intl.NumberFormatOptions, Record<string, JsonValue>>({}, json);
  }
  const fallback = DEFAULT_NUMBER_FORMATS[style];
  return fallback ?? failure("error", `number format "${style}" is not available`);
};

const withIntl = <T>(compute: () => T): T | IcuFailure => {
  try {
    return compute();
  } catch (error) {
    return failure("error", error instanceof Error ? error.message : String(error));
  }
};

const formatNumber = (
  value: number,
  style: string | null,
  options: IcuFormatOptions,
): string | IcuFailure => {
  if (options.locale === null) return failure("unknown", "locale is not statically known");
  const formatOptions = numberFormatOptions(style, options);
  if (isFailure(formatOptions)) return formatOptions;
  const locale = options.locale;
  return withIntl(() => new Intl.NumberFormat(locale, formatOptions).format(value));
};

const selectPlural = (
  element: IcuChoiceElement,
  value: number,
  locale: string | null,
): IcuElement[] | IcuFailure => {
  const exact = element.options.get(`=${value}`);
  if (exact) return exact;
  if (locale === null) return failure("unknown", "locale is not statically known");
  const rule = withIntl(() =>
    new Intl.PluralRules(locale, {
      type: element.kind === "selectordinal" ? "ordinal" : "cardinal",
    }).select(value - element.offset),
  );
  if (isFailure(rule)) return rule;
  const option = element.options.get(rule) ?? element.options.get("other");
  return option ?? failure("error", `no plural option for "${rule}"`);
};

interface FormatState {
  values: StaticValue;
  options: IcuFormatOptions;
  tools: StubRenderTools;
  tagCounters: Map<string, number>;
}

const callTagFunction = (
  element: IcuTagElement,
  tagFunction: StaticValue,
  children: IcuPart[],
  state: FormatState,
): IcuPart[] | IcuFailure => {
  const chunks = listValue(children.map(partToValue));
  const result = state.tools.call(tagFunction, [chunks]);
  const nextIndex = state.tagCounters.get(element.name) ?? 0;
  state.tagCounters.set(element.name, nextIndex + 1);
  const keyed =
    result.kind === "element"
      ? { ...result, key: primitiveValue(`${element.name}${nextIndex}`) }
      : result;
  if (keyed.kind === "unknown" || keyed.kind === "branch") {
    return failure("unknown", `tag function <${element.name}> returned ${keyed.kind}`);
  }
  if (keyed.kind === "list") {
    if (keyed.items.some((item) => item.kind === "repeat" || item.kind === "optional")) {
      return failure("unknown", `tag function <${element.name}> returned a list of unknown length`);
    }
    return keyed.items.map(partOf);
  }
  return [partOf(keyed)];
};

const formatToParts = (
  elements: IcuElement[],
  state: FormatState,
  pluralValue: number | null,
): IcuPart[] | IcuFailure => {
  const parts: IcuPart[] = [];
  for (const element of elements) {
    if (element.kind === "literal") {
      parts.push({ kind: "literal", value: element.value });
      continue;
    }
    if (element.kind === "pound") {
      if (pluralValue !== null) {
        const formatted = formatNumber(pluralValue, null, state.options);
        if (isFailure(formatted)) return formatted;
        parts.push({ kind: "literal", value: formatted });
      }
      continue;
    }
    const value = lookupValue(state.values, element.name);
    if (isFailure(value)) return value;
    switch (element.kind) {
      case "argument": {
        if (value.kind === "primitive") {
          const primitive = value.value;
          const isTextual =
            typeof primitive === "string" ||
            typeof primitive === "number" ||
            typeof primitive === "bigint";
          if (isTextual) parts.push({ kind: "literal", value: String(primitive) });
          else if (!primitive) parts.push({ kind: "literal", value: "" });
          else parts.push({ kind: "node", value });
          break;
        }
        if (
          value.kind === "unknown-primitive" &&
          (value.primitiveType === "string" || value.primitiveType === "number")
        ) {
          parts.push({ kind: "unknown-text", reason: value.reason });
          break;
        }
        if (
          value.kind === "unknown" ||
          value.kind === "unknown-primitive" ||
          value.kind === "branch"
        ) {
          return failure("unknown", `value of "${element.name}" is ${value.kind}`);
        }
        parts.push({ kind: "node", value });
        break;
      }
      case "number": {
        const numeric = knownNumber(value);
        if (isFailure(numeric)) return numeric;
        const formatted = formatNumber(numeric, element.style, state.options);
        if (isFailure(formatted)) return formatted;
        parts.push({ kind: "literal", value: formatted });
        break;
      }
      case "date":
      case "time":
        return failure("unknown", `${element.kind} formatting depends on the time zone and value`);
      case "tag": {
        if (value.kind !== "function" && value.kind !== "native-function") {
          return failure("error", `value for <${element.name}> is not a function`);
        }
        const children = formatToParts(element.children, state, pluralValue);
        if (isFailure(children)) return children;
        const chunks = callTagFunction(element, value, children, state);
        if (isFailure(chunks)) return chunks;
        parts.push(...chunks);
        break;
      }
      case "select": {
        if (!isKnownString(value)) {
          return failure("unknown", `select value "${element.name}" is ${value.kind}`);
        }
        const option = element.options.get(value.value) ?? element.options.get("other");
        if (!option) return failure("error", `no select option for "${value.value}"`);
        const nested = formatToParts(option, state, null);
        if (isFailure(nested)) return nested;
        parts.push(...nested);
        break;
      }
      case "plural":
      case "selectordinal": {
        const numeric = knownNumber(value);
        if (isFailure(numeric)) return numeric;
        const option = selectPlural(element, numeric, state.options.locale);
        if (isFailure(option)) return option;
        const nested = formatToParts(option, state, numeric - element.offset);
        if (isFailure(nested)) return nested;
        parts.push(...nested);
        break;
      }
    }
  }
  return mergeLiterals(parts);
};

const partsToValue = (parts: IcuPart[]): StaticValue => {
  if (parts.length === 0) return primitiveValue("");
  return parts.length === 1 ? partToValue(parts[0]) : listValue(parts.map(partToValue));
};

/**
 * `formatMessage` of `use-intl`: the plain string when nothing needs compiling,
 * otherwise the `intl-messageformat` result (a string, a single node, or the
 * list of merged parts).
 */
export const formatIcuMessage = (
  message: string,
  values: StaticValue,
  options: IcuFormatOptions,
  tools: StubRenderTools,
): IcuFormatResult => {
  if (getTruthiness(values) === false && !PLAIN_MESSAGE_PATTERN.test(message)) {
    return { kind: "value", value: primitiveValue(message) };
  }
  const elements = parseIcuMessage(message);
  if (elements === null) {
    return { kind: "unknown", reason: `ICU message syntax of "${message}" is not modeled` };
  }
  const parts = formatToParts(elements, { values, options, tools, tagCounters: new Map() }, null);
  if (isFailure(parts)) return { kind: parts.failure, reason: parts.reason };
  return { kind: "value", value: partsToValue(parts) };
};
