import path from "node:path";
import { z } from "zod";
import { createHeadersValue } from "../evaluate/headers.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import { awaitedValue } from "../evaluate/promises.js";
import { createUrlValue } from "../evaluate/url.js";
import {
  branchValue,
  describeValue,
  getObjectProperty,
  isKnownString,
  isNullish,
  isSameValue,
  listValue,
  NULL_VALUE,
  objectFromRecord,
  primitiveValue,
} from "../evaluate/values.js";
import { hasExportedName } from "../graph/module-record.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import { cookiesValue, type NextRequestModel } from "./next-request.js";
import { getResponseHeaders } from "./next-server.js";
import { findRouteFile } from "./route-files.js";
import type { ModuleRecord, StaticValue } from "../types.js";

// Runs the project's middleware (`middleware.*`, or `proxy.*` since next@16)
// the way `resolve-routes` does before a document request reaches the app
// router: the matcher decides whether it runs at all, and the response's
// headers are then copied onto the request the render reads through
// `next/headers`. Anything the middleware does that the analysis cannot follow
// leaves the request explicitly uncertain rather than silently unchanged.

const tryToParsePathModuleSchema = z.object({
  tryToParsePath: z.custom<(route: string) => { regexStr?: string }>(
    (value) => typeof value === "function",
  ),
});

const matcherEntrySchema = z.union([z.string(), z.object({ source: z.string() })]);

const IPC_FORBIDDEN_HEADERS = new Set([
  "accept-encoding",
  "keepalive",
  "keep-alive",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "expect",
]);

const ROUTER_ONLY_HEADERS = new Set([
  "content-length",
  "x-middleware-rewrite",
  "x-middleware-redirect",
  "x-middleware-refresh",
  "x-middleware-next",
  "x-middleware-override-headers",
]);

interface MiddlewareModule {
  module: ModuleRecord;
  handlerName: string;
}

const findMiddlewareModule = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): MiddlewareModule | null => {
  const rootDirectory = renderer.options.rootDirectory;
  for (const directory of [rootDirectory, path.join(rootDirectory, "src")]) {
    for (const baseName of ["proxy", "middleware"]) {
      const filePath = findRouteFile(directory, baseName);
      if (!filePath) continue;
      const module = renderer.loadModule(filePath);
      if (!module) {
        interpreter.report("next-middleware-parse", `could not parse ${filePath}`, null, "error");
        return null;
      }
      return { module, handlerName: hasExportedName(module, baseName) ? baseName : "default" };
    }
  }
  return null;
};

/** `getMiddlewareMatchers` without i18n or `basePath`: the source `next build` hands to path-to-regexp for one matcher entry. */
const toMatcherSource = (source: string): string =>
  `/:nextData(_next/data/[^/]{1,})?${source}${source === "/" ? "(/?index|/?index\\.json)?" : "{(\\.json)}?"}`;

/** Whether `config.matcher` selects `pathname`; null when the matcher is not statically readable. */
const matchesPathname = (
  rootDirectory: string,
  matcher: StaticValue,
  pathname: string,
): boolean | null => {
  if (isNullish(matcher) === true) return true;
  const entries = matcher.kind === "list" ? matcher.items : [matcher];
  const sources: string[] = [];
  for (const entry of entries) {
    const parsed = matcherEntrySchema.safeParse(toMatcherInput(entry));
    if (!parsed.success) return null;
    sources.push(typeof parsed.data === "string" ? parsed.data : parsed.data.source);
  }
  const loaded = getInstalledModules(rootDirectory).load("next/dist/lib/try-to-parse-path");
  const parsePath = loaded === null ? null : tryToParsePathModuleSchema.safeParse(loaded);
  if (!parsePath?.success) return null;
  return sources.some((source) => {
    const { regexStr } = parsePath.data.tryToParsePath(toMatcherSource(source));
    return regexStr !== undefined && new RegExp(regexStr).test(pathname);
  });
};

const toMatcherInput = (entry: StaticValue): unknown => {
  if (isKnownString(entry)) return entry.value;
  if (entry.kind !== "object") return undefined;
  const source = getObjectProperty(entry, "source");
  return isKnownString(source) ? { source: source.value } : undefined;
};

const requestValue = (request: NextRequestModel, url: URL): StaticValue => {
  const headerPairs = listValue(
    [...request.headers].map(([name, value]) => listValue([primitiveValue(name), value])),
  );
  const href = primitiveValue(url.href);
  return objectFromRecord({
    headers: createHeadersValue(headerPairs, null),
    cookies: cookiesValue(request),
    nextUrl: createUrlValue([href], null),
    url: href,
    method: primitiveValue("GET"),
  });
};

const cloneRequest = (request: NextRequestModel): NextRequestModel => ({
  headers: new Map(request.headers),
  uncertainty: request.uncertainty,
});

/** `resolve-routes`: the header overrides, then every other response header, land on the request. */
const applyResponse = (request: NextRequestModel, response: StaticValue): NextRequestModel => {
  const applied = cloneRequest(request);
  if (isNullish(response) === true) return applied;
  const headers = getResponseHeaders(response);
  if (headers === null) {
    applied.uncertainty = `a middleware response the analysis cannot read (${describeValue(response)})`;
    return applied;
  }
  if (headers.dynamicReason !== null) {
    applied.uncertainty = headers.dynamicReason;
    return applied;
  }
  const overrideList = headers.entries.get("x-middleware-override-headers");
  if (overrideList !== undefined) {
    if (!isKnownString(overrideList)) {
      applied.uncertainty = "middleware request header overrides with dynamic names";
      return applied;
    }
    const overridden = new Set(overrideList.value.split(",").map((name) => name.trim()));
    for (const name of applied.headers.keys()) {
      if (!overridden.has(name)) applied.headers.delete(name);
    }
    for (const name of overridden) {
      const value = headers.entries.get(`x-middleware-request-${name}`);
      if (value === undefined) applied.headers.delete(name);
      else applied.headers.set(name, value);
    }
  }
  for (const [name, value] of headers.entries) {
    if (
      ROUTER_ONLY_HEADERS.has(name) ||
      IPC_FORBIDDEN_HEADERS.has(name) ||
      name.startsWith("x-middleware-request-")
    ) {
      continue;
    }
    if (value.kind === "primitive" && !value.value) continue;
    applied.headers.set(name, value);
  }
  return applied;
};

/** The request each middleware path produces, joined so a header set on some paths only reads as a branch with `null`. */
const applyResponses = (request: NextRequestModel, response: StaticValue): NextRequestModel => {
  if (response.kind !== "branch") return applyResponse(request, response);
  const applied = response.alternatives.map((alternative) => applyResponse(request, alternative));
  const uncertainty = applied
    .map((alternative) => alternative.uncertainty)
    .find((reason) => reason !== null);
  const names = new Set(applied.flatMap((alternative) => [...alternative.headers.keys()]));
  const headers = new Map<string, StaticValue>();
  for (const name of names) {
    const values = applied.map((alternative) => alternative.headers.get(name) ?? NULL_VALUE);
    const [first, ...rest] = values;
    headers.set(
      name,
      first !== undefined && rest.every((value) => isSameValue(first, value))
        ? first
        : branchValue(values, response.reason, response.location, response.preferredIndex),
    );
  }
  return { headers, uncertainty: uncertainty ?? null };
};

const rewrittenPathname = (response: StaticValue, url: URL): string | null => {
  if (response.kind === "branch") return null;
  const rewrite = getResponseHeaders(response)?.entries.get("x-middleware-rewrite");
  if (rewrite === undefined || !isKnownString(rewrite)) return null;
  const destination = URL.parse(rewrite.value, url);
  return destination !== null && destination.origin === url.origin ? destination.pathname : null;
};

export interface MiddlewareOutcome {
  request: NextRequestModel;
  /** The pathname the router renders: the rewrite destination when the middleware rewrote. */
  pathname: string;
}

export const runNextMiddleware = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
  request: NextRequestModel,
  url: URL,
): MiddlewareOutcome => {
  const unchanged = { request, pathname: url.pathname };
  const middleware = findMiddlewareModule(renderer, interpreter);
  if (!middleware) return unchanged;
  const rootDirectory = renderer.options.rootDirectory;
  const config = hasExportedName(middleware.module, "config")
    ? interpreter.evaluateModuleExport(middleware.module, "config")
    : NULL_VALUE;
  const matcher = config.kind === "object" ? getObjectProperty(config, "matcher") : NULL_VALUE;
  const matches = matchesPathname(rootDirectory, matcher, url.pathname);
  if (matches === null) {
    return {
      ...unchanged,
      request: {
        ...cloneRequest(request),
        uncertainty: "a middleware whose matcher is not static",
      },
    };
  }
  if (!matches) return unchanged;
  const handler = interpreter.evaluateModuleExport(middleware.module, middleware.handlerName);
  const context = interpreter.createModuleContext(middleware.module, undefined, "server");
  const result = interpreter.callValue(handler, [requestValue(request, url)], context, null);
  const response = awaitedValue(result, null, () => interpreter.timers.drainMicrotasks());
  return {
    request: applyResponses(request, response),
    pathname: rewrittenPathname(response, url) ?? url.pathname,
  };
};
