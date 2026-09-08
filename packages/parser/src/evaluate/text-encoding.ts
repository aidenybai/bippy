import { nativeFunction } from "../frameworks/stubs.js";
import type { SourceLocation, StaticValue } from "../types.js";
import { createErrorValue } from "./errors.js";
import { bytesValue, getKnownBytes } from "./typed-arrays.js";
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

const isOmitted = (value: StaticValue | undefined): boolean =>
  value === undefined || (value.kind === "primitive" && value.value === undefined);

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
  if (isOmitted(value)) return undefined;
  if (
    value?.kind === "primitive" &&
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

/** `new TextEncoder()`: UTF-8 bytes of a known string. */
export const createTextEncoder = (): StaticValue =>
  objectFromRecord({
    encoding: primitiveValue("utf-8"),
    encode: nativeFunction("encode", ([input]) => {
      const text = isOmitted(input) ? "" : toCodecInput(input);
      return text === null
        ? unknownValue("TextEncoder.encode() of a dynamic string", null)
        : bytesValue("Uint8Array", new TextEncoder().encode(text));
    }),
  });

const toDecoderLabel = (value: StaticValue | undefined): string | null =>
  isOmitted(value)
    ? "utf-8"
    : value?.kind === "primitive" && typeof value.value === "string"
      ? value.value
      : null;

/** `new TextDecoder(label)`: the text of known bytes; a decoder over an unknown label decodes nothing. */
export const createTextDecoder = (
  label: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const encoding = toDecoderLabel(label);
  if (encoding === null) return unknownValue("new TextDecoder() with a dynamic label", location);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding);
  } catch {
    return thrownValue(
      "new TextDecoder() with an unsupported label",
      createErrorValue(
        "RangeError",
        [primitiveValue(`The "${encoding}" encoding is not supported`)],
        location,
      ),
      location,
    );
  }
  return objectFromRecord({
    encoding: primitiveValue(decoder.encoding),
    fatal: primitiveValue(decoder.fatal),
    ignoreBOM: primitiveValue(decoder.ignoreBOM),
    decode: nativeFunction("decode", ([input]) => {
      if (isOmitted(input)) return primitiveValue("");
      const bytes = getKnownBytes(input);
      return bytes === null
        ? unknownPrimitiveValue("string", "TextDecoder.decode() of dynamic bytes")
        : primitiveValue(decoder.decode(bytes));
    }),
  });
};

export const getBufferByteLength = (args: StaticValue[]): StaticValue => {
  const source = getBufferSource(args);
  return source
    ? primitiveValue(Buffer.byteLength(source.text, source.encoding))
    : unknownPrimitiveValue("number", "Buffer.byteLength() over a dynamic source");
};
