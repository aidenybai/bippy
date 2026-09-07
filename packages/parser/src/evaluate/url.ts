import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import { createErrorValue } from "./errors.js";
import { createSearchParamsValue, getSearchParamsString } from "./url-search-params.js";
import {
  accessorEntry,
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const hrefReaders = new WeakMap<StaticObjectValue, () => string | null>();

const nativeGetter = (name: string, read: () => StaticValue): StaticValue => ({
  kind: "native-function",
  name,
  call: read,
});

export const isUrlValue = (value: StaticObjectValue): boolean => hrefReaders.has(value);

const toUrlString = (value: StaticValue): string | null => {
  if (value.kind === "primitive") return String(value.value);
  const readHref = value.kind === "object" ? hrefReaders.get(value) : undefined;
  return readHref ? readHref() : null;
};

/** `new URL(input[, base])` over statically known strings, with `href`/`search` following `searchParams`. */
export const createUrlValue = (
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const [input, base] = args;
  const inputText = input === undefined ? null : toUrlString(input);
  const baseText = base === undefined ? undefined : toUrlString(base);
  if (inputText === null || baseText === null) {
    return unknownValue("new URL() from a dynamic string", location);
  }
  const parsed = URL.parse(inputText, baseText);
  if (!parsed) {
    return thrownValue(
      "new URL() with an invalid URL",
      createErrorValue("TypeError", [primitiveValue("Invalid URL")], location),
      location,
    );
  }
  const searchParams = createSearchParamsValue(primitiveValue(parsed.search));
  const self = objectFromRecord({
    origin: primitiveValue(parsed.origin),
    protocol: primitiveValue(parsed.protocol),
    host: primitiveValue(parsed.host),
    hostname: primitiveValue(parsed.hostname),
    port: primitiveValue(parsed.port),
    pathname: primitiveValue(parsed.pathname),
    hash: primitiveValue(parsed.hash),
    username: primitiveValue(parsed.username),
    password: primitiveValue(parsed.password),
    searchParams,
  });
  const readPart = (key: string): string | null => {
    const part = getObjectProperty(self, key);
    return part.kind === "primitive" ? String(part.value) : null;
  };
  const readSearch = (): string | null => {
    const query = getSearchParamsString(searchParams);
    return query === null ? null : query === "" ? "" : `?${query}`;
  };
  const readHref = (): string | null => {
    const parts = [readPart("origin"), readPart("pathname"), readSearch(), readPart("hash")];
    return parts.every((part) => part !== null) ? parts.join("") : null;
  };
  const stringGetter = (name: string, read: () => string | null): StaticValue =>
    nativeGetter(name, () => {
      const text = read();
      return text === null
        ? unknownPrimitiveValue("string", `URL.${name} after a dynamic write`)
        : primitiveValue(text);
    });
  const href = stringGetter("href", readHref);
  self.entries.push(
    accessorEntry("search", { get: stringGetter("search", readSearch), set: null }, location),
    accessorEntry("href", { get: href, set: null }, location),
    { kind: "property", key: "toString", value: href },
    { kind: "property", key: "toJSON", value: href },
  );
  hrefReaders.set(self, readHref);
  return self;
};
