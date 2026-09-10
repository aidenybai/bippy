import {
  FALSE_VALUE,
  NULL_VALUE,
  UNDEFINED_VALUE,
  isKnownString,
  listValue,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { CapturedRequest, StaticValue } from "../types.js";

// Static stand-in for `next/headers` (next@16). `headers()` reads the request as
// the render sees it: what the browser sent, less the flight headers, plus the
// `x-forwarded-*` headers `BaseServer.handleRequest` fills in when absent.
// `cookies()` parses the `cookie` header the same way `RequestCookies` does, and
// `draftMode()` is enabled only by the `__prerender_bypass` cookie. Without a
// captured request every read is an explicit unknown.

const FLIGHT_HEADERS = [
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-hmr-refresh",
  "next-router-segment-prefetch",
];

const PRERENDER_BYPASS_COOKIE = "__prerender_bypass";

interface RequestCookie {
  name: string;
  value: string;
}

/** `RequestCookies` (edge-runtime `parseCookie`): split on `;`, then on the first `=`; a bare name reads `"true"`, later duplicates win. */
const parseCookieHeader = (header: string): RequestCookie[] => {
  const cookies = new Map<string, string>();
  for (const pair of header.split(/; */)) {
    if (pair.length === 0) continue;
    const separator = pair.indexOf("=");
    if (separator === -1) {
      cookies.set(pair, "true");
      continue;
    }
    try {
      cookies.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
    } catch {}
  }
  return [...cookies].map(([name, value]) => ({ name, value }));
};

const forwardedHeaders = (
  host: StaticValue | undefined,
  origin: string | null,
): Record<string, StaticValue> => {
  const unknownServer = (what: string): StaticValue =>
    unknownPrimitiveValue("string", `the dev server's ${what}`);
  const serverUrl = origin === null ? null : new URL(origin);
  const isHttps = serverUrl?.protocol === "https:";
  return {
    "x-forwarded-host":
      host ?? (serverUrl ? primitiveValue(serverUrl.hostname) : unknownServer("hostname")),
    "x-forwarded-port": serverUrl
      ? primitiveValue(serverUrl.port || (isHttps ? "443" : "80"))
      : unknownServer("port"),
    "x-forwarded-proto": serverUrl
      ? primitiveValue(isHttps ? "https" : "http")
      : unknownServer("protocol"),
    "x-forwarded-for": unknownPrimitiveValue("string", "the socket's remote address"),
  };
};

const requestHeaders = (
  request: CapturedRequest,
  origin: string | null,
): Map<string, StaticValue> => {
  const headers = new Map<string, StaticValue>();
  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (!FLIGHT_HEADERS.includes(lowerName)) headers.set(lowerName, primitiveValue(value));
  }
  const forwarded = forwardedHeaders(headers.get("host"), origin);
  for (const [name, value] of Object.entries(forwarded)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
};

const pairList = (name: string, value: StaticValue): StaticValue =>
  listValue([primitiveValue(name), value]);

const headersValue = (headers: Map<string, StaticValue>): StaticValue => {
  const entries = [...headers].map(([name, value]) => pairList(name, value));
  const readName = (args: StaticValue[], read: (name: string) => StaticValue): StaticValue => {
    const [name] = args;
    return name !== undefined && isKnownString(name)
      ? read(name.value.toLowerCase())
      : unknownValue("dynamic header name");
  };
  return objectFromRecord({
    get: nativeFunction("get", (args) => readName(args, (name) => headers.get(name) ?? NULL_VALUE)),
    has: nativeFunction("has", (args) =>
      readName(args, (name) => primitiveValue(headers.has(name))),
    ),
    entries: nativeFunction("entries", () => listValue(entries)),
    keys: nativeFunction("keys", () => listValue([...headers.keys()].map(primitiveValue))),
    values: nativeFunction("values", () => listValue([...headers.values()])),
    forEach: nativeFunction("forEach", ([callback], tools) => {
      if (callback === undefined) return UNDEFINED_VALUE;
      for (const [name, value] of headers) tools.call(callback, [value, primitiveValue(name)]);
      return UNDEFINED_VALUE;
    }),
  });
};

const cookieValue = (cookie: RequestCookie): StaticValue =>
  objectFromRecord({ name: primitiveValue(cookie.name), value: primitiveValue(cookie.value) });

const cookiesValue = (cookies: RequestCookie[]): StaticValue => {
  const readName = (
    args: StaticValue[],
    read: (matching: RequestCookie[]) => StaticValue,
  ): StaticValue => {
    const [name] = args;
    if (name === undefined) return read(cookies);
    if (!isKnownString(name)) return unknownValue("dynamic cookie name");
    return read(cookies.filter((cookie) => cookie.name === name.value));
  };
  return objectFromRecord({
    get: nativeFunction("get", (args) =>
      readName(args, ([first]) => (first === undefined ? UNDEFINED_VALUE : cookieValue(first))),
    ),
    getAll: nativeFunction("getAll", (args) =>
      readName(args, (matching) => listValue(matching.map(cookieValue))),
    ),
    has: nativeFunction("has", (args) =>
      readName(args, (matching) => primitiveValue(matching.length > 0)),
    ),
    size: primitiveValue(cookies.length),
  });
};

/** The `next/headers` export, or null for an export the model does not cover. */
export const nextRequestValue = (
  importedName: string,
  request: CapturedRequest | null,
  origin: string | null,
): StaticValue | null => {
  if (importedName !== "headers" && importedName !== "cookies" && importedName !== "draftMode") {
    return null;
  }
  if (request === null) {
    return nativeFunction(importedName, () =>
      unknownValue(`${importedName}() reads the request; none was captured`),
    );
  }
  const headers = requestHeaders(request, origin);
  const cookieHeader = headers.get("cookie");
  const cookies =
    cookieHeader !== undefined && isKnownString(cookieHeader)
      ? parseCookieHeader(cookieHeader.value)
      : [];
  switch (importedName) {
    case "headers":
      return nativeFunction(importedName, () => headersValue(headers));
    case "cookies":
      return nativeFunction(importedName, () => cookiesValue(cookies));
    case "draftMode":
      return nativeFunction(importedName, () =>
        cookies.some((cookie) => cookie.name === PRERENDER_BYPASS_COOKIE)
          ? unknownValue("draft mode depends on the bypass cookie's value")
          : objectFromRecord({ isEnabled: FALSE_VALUE }),
      );
  }
};
