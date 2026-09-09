import { createHeadersValue, getHeadersState, type HeadersState } from "../evaluate/headers.js";
import {
  getObjectProperty,
  isKnownString,
  isNullish,
  listValue,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { StaticObjectValue, StaticValue } from "../types.js";

// Static stand-in for `next/server`'s `NextResponse` (next@16). Each static
// constructor builds a response whose `headers` carry the markers the router
// reads back (`x-middleware-next`, `x-middleware-rewrite`, `location`) and,
// for `init.request.headers`, the `x-middleware-request-*` overrides. Writes
// through `cookies` mirror `ResponseCookies`: they land on `set-cookie` and
// `x-middleware-set-cookie`, which is how the render's `cookies()` sees them.

const MIDDLEWARE_SET_COOKIE_HEADER = "x-middleware-set-cookie";

const responsesByValue = new WeakMap<StaticObjectValue, HeadersState>();

/** The headers of a modeled `NextResponse`, as `resolve-routes` reads them off a middleware's response; null for other values. */
export const getResponseHeaders = (value: StaticValue): HeadersState | null =>
  (value.kind === "object" ? responsesByValue.get(value) : undefined) ?? null;

const toCookieString = (value: StaticValue): string | null =>
  value.kind === "primitive" ? String(value.value) : null;

const readInitProperty = (init: StaticValue | undefined, key: string): StaticValue | undefined =>
  init !== undefined && init.kind === "object" ? getObjectProperty(init, key) : undefined;

const isAbsent = (value: StaticValue | undefined): boolean =>
  value === undefined || isNullish(value) === true;

interface ResponseCookie {
  name: string;
  value: string;
}

/** `ResponseCookies.set(name, value)` / `set({ name, value })`: the cookie as `stringifyCookie` serializes its pair. */
const toResponseCookie = (args: StaticValue[]): ResponseCookie | null => {
  const [first, second] = args;
  if (first === undefined) return null;
  if (first.kind === "object") {
    const name = getObjectProperty(first, "name");
    const value = getObjectProperty(first, "value");
    const nameText = toCookieString(name);
    const valueText = toCookieString(value);
    return nameText === null || valueText === null ? null : { name: nameText, value: valueText };
  }
  const nameText = toCookieString(first);
  const valueText = second === undefined ? "" : toCookieString(second);
  return nameText === null || valueText === null ? null : { name: nameText, value: valueText };
};

const serializeCookie = (cookie: ResponseCookie): string =>
  `${cookie.name}=${encodeURIComponent(cookie.value)}`;

const cookieValue = (cookie: ResponseCookie): StaticValue =>
  objectFromRecord({ name: primitiveValue(cookie.name), value: primitiveValue(cookie.value) });

const createResponse = (
  headers: StaticValue,
  headersState: HeadersState,
  status: number,
): StaticValue => {
  const cookies = new Map<string, ResponseCookie>();
  const writeCookieHeaders = (): void => {
    const serialized = [...cookies.values()].map(serializeCookie);
    headersState.entries.set("set-cookie", primitiveValue(serialized.join(", ")));
    headersState.entries.set(MIDDLEWARE_SET_COOKIE_HEADER, primitiveValue(serialized.join(",")));
  };
  const cookieName = (args: StaticValue[]): string | null => {
    const [first] = args;
    if (first === undefined) return null;
    return first.kind === "object"
      ? toCookieString(getObjectProperty(first, "name"))
      : toCookieString(first);
  };
  const cookiesValue = objectFromRecord({
    set: nativeFunction("set", (args) => {
      const cookie = toResponseCookie(args);
      if (cookie === null) {
        headersState.dynamicReason = "ResponseCookies.set() with a dynamic name or value";
      } else {
        cookies.set(cookie.name, cookie);
        writeCookieHeaders();
      }
      return cookiesValue;
    }),
    delete: nativeFunction("delete", (args) => {
      const name = cookieName(args);
      if (name === null) {
        headersState.dynamicReason = "ResponseCookies.delete() with a dynamic name";
      } else {
        cookies.set(name, { name, value: "" });
        writeCookieHeaders();
      }
      return cookiesValue;
    }),
    get: nativeFunction("get", (args) => {
      const name = cookieName(args);
      if (name === null) return unknownValue("ResponseCookies.get() with a dynamic name");
      const cookie = cookies.get(name);
      return cookie === undefined ? UNDEFINED_VALUE : cookieValue(cookie);
    }),
    getAll: nativeFunction("getAll", (args) => {
      if (args.length === 0) return listValue([...cookies.values()].map(cookieValue));
      const name = cookieName(args);
      if (name === null) return unknownValue("ResponseCookies.getAll() with a dynamic name");
      const cookie = cookies.get(name);
      return listValue(cookie === undefined ? [] : [cookieValue(cookie)]);
    }),
    has: nativeFunction("has", (args) => {
      const name = cookieName(args);
      return name === null
        ? unknownValue("ResponseCookies.has() with a dynamic name")
        : primitiveValue(cookies.has(name));
    }),
  });
  const self = objectFromRecord({
    headers,
    cookies: cookiesValue,
    status: primitiveValue(status),
    ok: primitiveValue(status >= 200 && status < 300),
  });
  responsesByValue.set(self, headersState);
  return self;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** `handleMiddlewareField`: `init.request.headers` become `x-middleware-request-*` plus the override list. */
const applyRequestOverrides = (headers: HeadersState, init: StaticValue | undefined): boolean => {
  const request = readInitProperty(init, "request");
  const overrides = readInitProperty(request, "headers");
  if (isAbsent(overrides)) return true;
  const overrideState = overrides === undefined ? null : getHeadersState(overrides);
  if (overrideState === null || overrideState.dynamicReason !== null) return false;
  for (const [name, value] of overrideState.entries) {
    headers.entries.set(`x-middleware-request-${name}`, value);
  }
  headers.entries.set(
    "x-middleware-override-headers",
    primitiveValue([...overrideState.entries.keys()].join(",")),
  );
  return true;
};

const toStatus = (init: StaticValue | undefined, fallback: number): number | null => {
  if (init === undefined) return fallback;
  if (init.kind === "primitive" && typeof init.value === "number") return init.value;
  const status = readInitProperty(init, "status");
  if (isAbsent(status)) return fallback;
  return status !== undefined && status.kind === "primitive" && typeof status.value === "number"
    ? status.value
    : null;
};

const toUrlString = (value: StaticValue | undefined): string | null => {
  if (value === undefined) return null;
  if (isKnownString(value)) return value.value;
  if (value.kind !== "object") return null;
  const href = getObjectProperty(value, "href");
  return isKnownString(href) ? href.value : null;
};

const construct = (
  init: StaticValue | undefined,
  marker: (headers: HeadersState) => boolean,
  status: number | null,
): StaticValue => {
  const headers = createHeadersValue(readInitProperty(init, "headers"), null);
  const headersState = getHeadersState(headers);
  if (headersState === null || status === null || !marker(headersState)) {
    return unknownValue("NextResponse built from a dynamic init");
  }
  return createResponse(headers, headersState, status);
};

const NEXT_RESPONSE = objectFromRecord({
  next: nativeFunction("next", ([init]) =>
    construct(
      init,
      (headers) => {
        headers.entries.set("x-middleware-next", primitiveValue("1"));
        return applyRequestOverrides(headers, init);
      },
      toStatus(init, 200),
    ),
  ),
  rewrite: nativeFunction("rewrite", ([destination, init]) => {
    const url = toUrlString(destination);
    return construct(
      init,
      (headers) => {
        if (url === null) return false;
        headers.entries.set("x-middleware-rewrite", primitiveValue(url));
        return applyRequestOverrides(headers, init);
      },
      toStatus(init, 200),
    );
  }),
  redirect: nativeFunction("redirect", ([destination, init]) => {
    const url = toUrlString(destination);
    const status = toStatus(init, 307);
    return construct(
      init !== undefined && init.kind === "primitive" ? undefined : init,
      (headers) => {
        if (url === null) return false;
        headers.entries.set("location", primitiveValue(url));
        return true;
      },
      status !== null && REDIRECT_STATUSES.has(status) ? status : null,
    );
  }),
  json: nativeFunction("json", ([, init]) =>
    construct(
      init,
      (headers) => {
        if (!headers.entries.has("content-type")) {
          headers.entries.set("content-type", primitiveValue("application/json"));
        }
        return true;
      },
      toStatus(init, 200),
    ),
  ),
});

/** The `next/server` export, or null for one the model does not cover. */
export const nextServerValue = (importedName: string): StaticValue | null =>
  importedName === "NextResponse" ? NEXT_RESPONSE : null;
