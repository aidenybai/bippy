import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RouteRecord } from "./react-router.js";
import { routeIdFromFile } from "./route-files.js";

// Remix 1's `defineConventionalRoutes` (the default until `future.v2_routeConvention`):
// dots split URL segments, subdirectories nest under the same-named module,
// `index` is the index route, `$param`/`$` are dynamic/splat, `[.]` escapes,
// `(x)` is optional and a leading `__` is a pathless segment.

const ROUTE_MODULE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".md", ".mdx"]);
const PARAM_PREFIX = "$";
const ESCAPE_START = "[";
const ESCAPE_END = "]";
const OPTIONAL_START = "(";
const OPTIONAL_END = ")";
const INDEX_SUFFIX = "/index";

const listFiles = (directory: string, base: string, out: string[]): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(filePath, base, out);
    else if (entry.isFile()) out.push(path.relative(base, filePath).split(path.sep).join("/"));
  }
};

const isSegmentSeparator = (character: string | undefined): boolean =>
  character === "/" || character === ".";

const createRoutePath = (partialRouteId: string): string | undefined => {
  let result = "";
  let rawSegmentBuffer = "";
  let escapeDepth = 0;
  let optionalDepth = 0;
  let optionalSegmentIndex: number | null = null;
  let isSkippingSegment = false;
  for (let index = 0; index < partialRouteId.length; index++) {
    const character = partialRouteId.charAt(index);
    const previous = index > 0 ? partialRouteId.charAt(index - 1) : undefined;
    const next = index < partialRouteId.length - 1 ? partialRouteId.charAt(index + 1) : undefined;
    if (isSkippingSegment) {
      if (isSegmentSeparator(character)) isSkippingSegment = false;
      continue;
    }
    if (escapeDepth === 0 && character === ESCAPE_START && previous !== ESCAPE_START) {
      escapeDepth++;
      continue;
    }
    if (escapeDepth > 0 && character === ESCAPE_END && next !== ESCAPE_END) {
      escapeDepth--;
      continue;
    }
    if (
      character === OPTIONAL_START &&
      previous !== OPTIONAL_START &&
      (isSegmentSeparator(previous) || previous === undefined) &&
      optionalDepth === 0 &&
      escapeDepth === 0
    ) {
      optionalDepth++;
      optionalSegmentIndex = result.length;
      result += OPTIONAL_START;
      continue;
    }
    if (
      character === OPTIONAL_END &&
      next !== OPTIONAL_END &&
      (isSegmentSeparator(next) || next === undefined) &&
      optionalDepth > 0 &&
      escapeDepth === 0
    ) {
      if (optionalSegmentIndex !== null) {
        result = result.slice(0, optionalSegmentIndex) + result.slice(optionalSegmentIndex + 1);
      }
      optionalSegmentIndex = null;
      optionalDepth--;
      result += "?";
      continue;
    }
    if (escapeDepth > 0) {
      result += character;
      continue;
    }
    if (isSegmentSeparator(character)) {
      if (rawSegmentBuffer === "index" && result.endsWith("index")) {
        result = result.replace(/\/?index$/, "");
      } else {
        result += "/";
      }
      rawSegmentBuffer = "";
      optionalDepth = 0;
      optionalSegmentIndex = null;
      continue;
    }
    if (character === "_" && next === "_" && !rawSegmentBuffer) {
      isSkippingSegment = true;
      continue;
    }
    rawSegmentBuffer += character;
    if (character === PARAM_PREFIX) {
      result += next === undefined ? "*" : ":";
      continue;
    }
    result += character;
  }
  if (rawSegmentBuffer === "index" && result.endsWith("index")) {
    result = result.replace(/\/?index$/, "");
  }
  return result || undefined;
};

const toRecords = (
  routeIds: string[],
  files: Map<string, string>,
  parentIds: Map<string, string | undefined>,
  parentId: string | undefined,
  routesDirectoryName: string,
): RouteRecord[] =>
  routeIds
    .filter((routeId) => parentIds.get(routeId) === parentId)
    .map((routeId): RouteRecord => {
      const isIndex = routeId.endsWith(INDEX_SUFFIX);
      return {
        id: routeId,
        path: createRoutePath(routeId.slice((parentId ?? routesDirectoryName).length + 1)) ?? null,
        index: isIndex,
        element: null,
        component: null,
        file: files.get(routeId) ?? null,
        children: isIndex
          ? []
          : toRecords(routeIds, files, parentIds, routeId, routesDirectoryName),
        uncertainty: null,
      };
    });

/**
 * The route tree `defineConventionalRoutes(appDirectory, ignoredRouteFiles)`
 * builds; `ignoredRouteFiles` are minimatch patterns against the path inside
 * the routes directory.
 */
export const readConventionalRoutes = (
  appDirectory: string,
  ignoredRouteFiles: string[],
  routesDirectoryName = "routes",
): RouteRecord[] => {
  const routesDirectory = path.join(appDirectory, routesDirectoryName);
  if (!existsSync(routesDirectory)) return [];
  const relativeFiles: string[] = [];
  listFiles(routesDirectory, routesDirectory, relativeFiles);
  const files = new Map<string, string>();
  for (const file of relativeFiles) {
    if (ignoredRouteFiles.some((pattern) => path.matchesGlob(file, pattern))) continue;
    if (!ROUTE_MODULE_EXTENSIONS.has(path.extname(file))) continue;
    files.set(`${routesDirectoryName}/${routeIdFromFile(file)}`, `${routesDirectoryName}/${file}`);
  }
  const routeIds = [...files.keys()].sort((left, right) => right.length - left.length);
  const parentIds = new Map(
    routeIds.map((routeId) => [
      routeId,
      routeIds.find((candidate) => routeId.startsWith(`${candidate}/`)),
    ]),
  );
  return toRecords(routeIds, files, parentIds, undefined, routesDirectoryName);
};
