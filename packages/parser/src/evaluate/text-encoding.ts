import { nativeFunction } from "../frameworks/stubs.js";
import type { SourceLocation, StaticValue } from "../types.js";
import { createErrorValue } from "./errors.js";
import {
  objectFromRecord,
  primitiveValue,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const STRING_CODECS: Record<string, (text: string) => string> = {
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  decodeURI,
  btoa,
  atob,
};

export const isStringCodecName = (name: string): boolean => Object.hasOwn(STRING_CODECS, name);

const toCodecInput = (value: StaticValue | undefined): string | null =>
  value === undefined
    ? "undefined"
    : value.kind === "primitive" && typeof value.value !== "symbol"
      ? String(value.value)
      : null;

/** The URI and base64 codecs over a known string; malformed input throws as the engine does. */
export const callStringCodec = (
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const text = toCodecInput(args[0]);
  if (text === null) return unknownPrimitiveValue("string", `${name}()`);
  try {
    return primitiveValue(STRING_CODECS[name](text));
  } catch (error) {
    const isUriError = error instanceof URIError;
    return thrownValue(
      `${name}() with malformed input`,
      createErrorValue(
        isUriError ? "URIError" : "Error",
        [primitiveValue(error instanceof Error ? error.message : String(error))],
        location,
      ),
      location,
    );
  }
};

/** A known encoding argument (omitted counts as the default); null when it cannot be decided. */
const getBufferEncoding = (value: StaticValue | undefined): BufferEncoding | undefined | null => {
  if (value === undefined || (value.kind === "primitive" && value.value === undefined))
    return undefined;
  if (
    value.kind === "primitive" &&
    typeof value.value === "string" &&
    Buffer.isEncoding(value.value)
  )
    return value.value;
  return null;
};

const getBufferSource = (
  args: StaticValue[],
): { text: string; encoding: BufferEncoding | undefined } | null => {
  const [source, encodingArgument] = args;
  const encoding = getBufferEncoding(encodingArgument);
  if (source?.kind !== "primitive" || typeof source.value !== "string" || encoding === null)
    return null;
  return { text: source.value, encoding };
};

/** `Buffer.from(string[, encoding])` as the bundler's polyfill computes it; only string sources are followed. */
export const createBufferValue = (
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const source = getBufferSource(args);
  if (!source) return unknownValue("Buffer.from() over a dynamic source", location);
  const buffer = Buffer.from(source.text, source.encoding);
  return objectFromRecord({
    length: primitiveValue(buffer.length),
    byteLength: primitiveValue(buffer.byteLength),
    toString: nativeFunction("toString", ([targetEncoding]) => {
      const encoding = getBufferEncoding(targetEncoding);
      return encoding === null
        ? unknownPrimitiveValue("string", "Buffer.toString() with a dynamic encoding")
        : primitiveValue(buffer.toString(encoding));
    }),
  });
};

export const getBufferByteLength = (args: StaticValue[]): StaticValue => {
  const source = getBufferSource(args);
  return source
    ? primitiveValue(Buffer.byteLength(source.text, source.encoding))
    : unknownPrimitiveValue("number", "Buffer.byteLength() over a dynamic source");
};
