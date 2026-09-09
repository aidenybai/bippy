import {
  FALSE_VALUE,
  NULL_VALUE,
  UNDEFINED_VALUE,
  isKnownString,
  listValue,
  mapValue,
  objectFromRecord,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { CapturedRequest, StaticValue } from "../types.js";

// Static stand-in for `next/headers` (next@16). `headers()` reads the request as
// the render sees it: what the browser sent, less the flight headers, plus the
// `x-forwarded-*` headers `BaseServer.handleRequest` fills in when absent, plus
// whatever the middleware's response added (`resolve-routes` copies those onto
// the request). `cookies()` parses the `cookie` header the same way
// `RequestCookies` does and merges the cookies the middleware set
// (`x-middleware-set-cookie`); `draftMode()` is enabled only by the
// `__prerender_bypass` cookie. Without a captured request every read is an
// explicit unknown.

const FLIGHT_HEADERS = [
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-hmr-refresh",
  "next-router-segment-prefetch",
];

const PRERENDER_BYPASS_COOKIE = "__prerender_bypass";
const MIDDLEWARE_SET_COOKIE_HEADER = "x-middleware-set-cookie";

/** The document request as the render reads it, once the middleware has run. */
export interface NextRequestModel {
  /** Lower-cased header names; a value is a branch with `null` when the middleware sets the header on some paths only. */
  headers: Map<string, StaticValue>;
  /** Why headers beyond these may be present (a middleware whose response is not modeled); null when the set is complete. */
  uncertainty: string | null;
}

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

/** `mergeMiddlewareCookies`: each `Set-Cookie` the middleware wrote overrides the browser's cookie of that name. */
const mergeMiddlewareCookies = (cookies: RequestCookie[], setCookie: string): RequestCookie[] => {
  const merged = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  for (const serialized of setCookie.split(",")) {
    const [first] = parseCookieHeader(serialized);
    if (first) merged.set(first.name, first.value);
  }
  return [...merged].map(([name, value]) => ({ name, value }));
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

export const createNextRequestModel = (
  request: CapturedRequest,
  origin: string | null,
): NextRequestModel => {
  const headers = new Map<string, StaticValue>();
  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (!FLIGHT_HEADERS.includes(lowerName)) headers.set(lowerName, primitiveValue(value));
  }
  const forwarded = forwardedHeaders(headers.get("host"), origin);
  for (const [name, value] of Object.entries(forwarded)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return { headers, uncertainty: null };
};

const isNull = (value: StaticValue): boolean => value.kind === "primitive" && value.value === null;

const isPossiblyAbsent = (value: StaticValue): boolean =>
  value.kind === "branch" ? value.alternatives.some(isNull) : isNull(value);

const pairList = (name: string, value: StaticValue): StaticValue =>
  listValue([primitiveValue(name), value]);

/** A read-only `Headers` over `headers`, as `headers()` returns. */
export const headersValue = (model: NextRequestModel): StaticValue => {
  const { headers } = model;
  const readName = (args: StaticValue[], read: (name: string) => StaticValue): StaticValue => {
    const [name] = args;
    return name !== undefined && isKnownString(name)
      ? read(name.value.toLowerCase())
      : unknownValue("dynamic header name");
  };
  const readHeader = (name: string): StaticValue =>
    headers.get(name) ??
    (model.uncertainty === null
      ? NULL_VALUE
      : unknownValue(`the ${name} header may be set by ${model.uncertainty}`));
  const whole = <Result extends StaticValue>(read: () => Result): StaticValue => {
    if (model.uncertainty !== null) {
      return unknownValue(`headers may be added by ${model.uncertainty}`);
    }
    const uncertain = [...headers].find(([, value]) => isPossiblyAbsent(value));
    return uncertain
      ? unknownValue(`the ${uncertain[0]} header is present on some middleware paths only`)
      : read();
  };
  return objectFromRecord({
    get: nativeFunction("get", (args) => readName(args, readHeader)),
    has: nativeFunction("has", (args) =>
      readName(args, (name) =>
        mapValue(readHeader(name), (value) =>
          value.kind === "unknown" ? value : primitiveValue(!isNull(value)),
        ),
      ),
    ),
    entries: nativeFunction("entries", () =>
      whole(() => listValue([...headers].map(([name, value]) => pairList(name, value)))),
    ),
    keys: nativeFunction("keys", () =>
      whole(() => listValue([...headers.keys()].map(primitiveValue))),
    ),
    values: nativeFunction("values", () => whole(() => listValue([...headers.values()]))),
    forEach: nativeFunction("forEach", ([callback], tools) =>
      whole(() => {
        if (callback === undefined) return UNDEFINED_VALUE;
        for (const [name, value] of headers) tools.call(callback, [value, primitiveValue(name)]);
        return UNDEFINED_VALUE;
      }),
    ),
  });
};

const cookieValue = (cookie: RequestCookie): StaticValue =>
  objectFromRecord({ name: primitiveValue(cookie.name), value: primitiveValue(cookie.value) });

const knownCookies = (model: NextRequestModel): RequestCookie[] | null => {
  const cookieHeader = model.headers.get("cookie");
  const setCookie = model.headers.get(MIDDLEWARE_SET_COOKIE_HEADER);
  if (cookieHeader !== undefined && !isKnownString(cookieHeader) && !isNull(cookieHeader)) {
    return null;
  }
  if (setCookie !== undefined && !isKnownString(setCookie) && !isNull(setCookie)) return null;
  const browserCookies =
    cookieHeader !== undefined && isKnownString(cookieHeader)
      ? parseCookieHeader(cookieHeader.value)
      : [];
  return setCookie !== undefined && isKnownString(setCookie)
    ? mergeMiddlewareCookies(browserCookies, setCookie.value)
    : browserCookies;
};

/** A read-only `RequestCookies` over the request's cookies, as `cookies()` returns. */
export const cookiesValue = (model: NextRequestModel): StaticValue => {
  const cookies = knownCookies(model);
  if (cookies === null) {
    return unknownValue("cookies depend on what the middleware set on this path");
  }
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

/** The `next/headers` export, or null for an export the model does not cover; `getModel` is read per call since the middleware may still replace the request. */
export const nextRequestValue = (
  importedName: string,
  getModel: () => NextRequestModel | null,
): StaticValue | null => {
  if (importedName !== "headers" && importedName !== "cookies" && importedName !== "draftMode") {
    return null;
  }
  return nativeFunction(importedName, () => {
    const model = getModel();
    if (model === null) {
      return unknownValue(`${importedName}() reads the request; none was captured`);
    }
    switch (importedName) {
      case "headers":
        return headersValue(model);
      case "cookies":
        return cookiesValue(model);
      case "draftMode": {
        const cookies = knownCookies(model);
        return cookies === null
          ? unknownValue("draft mode depends on the cookies the middleware set")
          : cookies.some((cookie) => cookie.name === PRERENDER_BYPASS_COOKIE)
            ? unknownValue("draft mode depends on the bypass cookie's value")
            : objectFromRecord({ isEnabled: FALSE_VALUE });
      }
    }
  });
};
