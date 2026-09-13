import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import { createErrorValue } from "./errors.js";
import {
  createSearchParamsValue,
  getSearchParamsString,
  replaceSearchParams,
} from "./url-search-params.js";
import {
  accessorEntry,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

type UrlPart =
  | "href"
  | "origin"
  | "protocol"
  | "username"
  | "password"
  | "host"
  | "hostname"
  | "port"
  | "pathname"
  | "search"
  | "hash";

type WritableUrlPart = Exclude<UrlPart, "origin">;

interface UrlState {
  url: URL;
  searchParams: StaticValue;
  /** Set once a component was assigned a value the analysis could not read. */
  dynamicReason: string | null;
}

const URL_PARTS: readonly UrlPart[] = [
  "href",
  "origin",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
];

const urlStates = new WeakMap<StaticObjectValue, UrlState>();

const nativeFunction = (name: string, call: (args: StaticValue[]) => StaticValue): StaticValue => ({
  kind: "native-function",
  name,
  call,
});

const toUrlString = (value: StaticValue): string | null => {
  if (value.kind === "primitive") return String(value.value);
  const state = value.kind === "object" ? urlStates.get(value) : undefined;
  return state ? readPart(state, "href") : null;
};

/** Mirrors the live-linked `searchParams` into the URL's query; false once a write made them dynamic. */
const syncSearch = (state: UrlState): boolean => {
  const query = getSearchParamsString(state.searchParams);
  if (query === null) return false;
  state.url.search = query;
  return true;
};

const readPart = (state: UrlState, part: UrlPart): string | null => {
  if (state.dynamicReason !== null) return null;
  if ((part === "href" || part === "search") && !syncSearch(state)) return null;
  return state.url[part];
};

const invalidUrl = (location: SourceLocation | null): StaticValue =>
  thrownValue(
    "new URL() with an invalid URL",
    createErrorValue("TypeError", [primitiveValue("Invalid URL")], location),
    location,
  );

/** The WHATWG setters: `href` reparses (throwing on an invalid URL), `search` replaces the linked params, the others normalize or ignore their input. */
const writePart = (
  state: UrlState,
  part: WritableUrlPart,
  value: StaticValue,
  location: SourceLocation | null,
): StaticValue => {
  if (value.kind !== "primitive") {
    state.dynamicReason = `URL.${part} after a dynamic write`;
    replaceSearchParams(state.searchParams, null, state.dynamicReason);
    return UNDEFINED_VALUE;
  }
  const text = String(value.value);
  if (part === "href") {
    const parsed = URL.parse(text);
    if (!parsed) return invalidUrl(location);
    state.url = parsed;
  } else {
    if (part !== "search") syncSearch(state);
    state.url[part] = text;
  }
  if (part === "href" || part === "search") {
    replaceSearchParams(state.searchParams, state.url.search, null);
  }
  return UNDEFINED_VALUE;
};

export const isUrlValue = (value: StaticObjectValue): boolean => urlStates.has(value);

/** The `URL` a modeled instance stands for; null for other objects or once its href is uncertain. */
export const toNativeUrl = (value: StaticObjectValue): URL | null => {
  const state = urlStates.get(value);
  const href = state ? readPart(state, "href") : null;
  return href === null ? null : URL.parse(href);
};

/** `new URL(input[, base])` over statically known strings, with every component readable and assignable. */
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
  if (!parsed) return invalidUrl(location);
  const state: UrlState = {
    url: parsed,
    searchParams: createSearchParamsValue(primitiveValue(parsed.search)),
    dynamicReason: null,
  };
  const getter = (part: UrlPart): StaticValue =>
    nativeFunction(part, () => {
      const text = readPart(state, part);
      return text === null
        ? unknownPrimitiveValue(
            "string",
            state.dynamicReason ?? `URL.${part} after a dynamic searchParams write`,
          )
        : primitiveValue(text);
    });
  const setter = (part: WritableUrlPart): StaticValue =>
    nativeFunction(part, ([value = UNDEFINED_VALUE]) => writePart(state, part, value, location));
  const href = getter("href");
  const self = objectFromRecord({ searchParams: state.searchParams, toString: href, toJSON: href });
  self.entries.push(
    ...URL_PARTS.map((part) =>
      accessorEntry(
        part,
        { get: getter(part), set: part === "origin" ? null : setter(part) },
        location,
      ),
    ),
  );
  urlStates.set(self, state);
  return self;
};
