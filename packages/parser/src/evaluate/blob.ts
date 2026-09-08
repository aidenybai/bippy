import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import { nativeFunction } from "../frameworks/stubs.js";
import { resolvedPromiseValue } from "./promises.js";
import {
  getObjectProperty,
  isKnownString,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/** The UTF-8 text of a blob whose every part is a known string; null once a part is binary or dynamic. */
const blobTexts = new WeakMap<StaticObjectValue, string | null>();

export const isBlobValue = (value: StaticObjectValue): boolean => blobTexts.has(value);

const toPartText = (part: StaticValue): string | null => {
  if (part.kind === "primitive") return String(part.value);
  if (part.kind === "object" && blobTexts.has(part)) return blobTexts.get(part) ?? null;
  return null;
};

const toBlobText = (parts: StaticValue | undefined): string | null => {
  if (parts === undefined) return "";
  if (parts.kind !== "list") return null;
  const texts = parts.items.map(toPartText);
  return texts.every((text): text is string => text !== null) ? texts.join("") : null;
};

const toBlobType = (options: StaticValue | undefined): StaticValue => {
  if (options === undefined || options.kind !== "object") return primitiveValue("");
  const type = getObjectProperty(options, "type");
  if (type.kind === "primitive" && type.value === undefined) return primitiveValue("");
  return isKnownString(type)
    ? primitiveValue(type.value.toLowerCase())
    : unknownPrimitiveValue("string", "Blob type from a dynamic option");
};

/** `new Blob(parts?, options?)`: its size is the UTF-8 length of its parts while every part is a known string. */
export const createBlobValue = (
  args: StaticValue[],
  location: SourceLocation | null,
): StaticObjectValue => {
  const [parts, options] = args;
  const text = toBlobText(parts);
  const size =
    text === null
      ? unknownPrimitiveValue("number", "Blob size over dynamic parts")
      : primitiveValue(Buffer.byteLength(text, "utf8"));
  const blob = objectFromRecord({
    size,
    type: toBlobType(options),
    text: nativeFunction("text", () =>
      text === null
        ? unknownValue("Blob.text() over dynamic parts", location)
        : resolvedPromiseValue(primitiveValue(text)),
    ),
    arrayBuffer: nativeFunction("arrayBuffer", () => unknownValue("Blob.arrayBuffer()", location)),
    slice: nativeFunction("slice", () => unknownValue("Blob.slice()", location)),
  });
  blobTexts.set(blob, text);
  return blob;
};
