import { readdirSync } from "node:fs";
import path from "node:path";
import type { RouteRecord } from "./react-router.js";
import { routeIdFromFile } from "./route-files.js";

// File-convention routes as `react-router-auto-routes` (the React Router v7
// successor of remix-flat-routes) derives them from `app/routes`:
//
//   index.tsx / _index.tsx  index route of the enclosing folder
//   _layout.tsx             the only file that nests; children are the routes
//                           sharing its folder prefix
//   _group/                 pathless folder (no URL segment)
//   $param, $, ($param)     dynamic, splat, optional segments
//   a.b.tsx                 dots split segments like folders do; `[.]` escapes
//   name_                   a trailing underscore opts the segment out of the
//                           layout at that level
//   +anything               colocated non-route files
//
// Dot-delimited routes are siblings unless a `_layout` exists for their prefix.

export const AUTO_ROUTES_PACKAGE = "react-router-auto-routes";
const ROUTE_FILE_PATTERN = /\.(ts|tsx|js|jsx|md|mdx)$/;
const COLOCATION_PREFIX = "+";
const PARAM_PREFIX = "$";
const LAYOUT_SEGMENT = "_layout";
const INDEX_SEGMENTS = new Set(["index", "_index"]);
const DEFAULT_IGNORED = [
  /^\./,
  /\.css$/,
  /\.test\.[jt]sx?$/,
  /^__/,
  /\.server\.[^.]+$/,
  /\.client\.[^.]+$/,
];

interface RouteFile {
  /** Path relative to the app directory (`routes/users/$id/index.tsx`). */
  file: string;
  /** Convention segments with the trailing `index`/`_layout` marker removed. */
  segments: string[];
  kind: "layout" | "index" | "page";
}

interface RouteNode {
  file: RouteFile;
  children: RouteNode[];
}

const isIgnored = (name: string): boolean =>
  name.startsWith(COLOCATION_PREFIX) || DEFAULT_IGNORED.some((pattern) => pattern.test(name));

/** Splits `a.b[.]c` into `["a", "b.c"]`: dots separate segments unless bracket-escaped. */
const splitDots = (part: string): string[] => {
  const segments: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of part) {
    if (character === "[") depth++;
    else if (character === "]") depth = Math.max(0, depth - 1);
    else if (character === "." && depth === 0) {
      segments.push(current);
      current = "";
    } else current += character;
  }
  segments.push(current);
  return segments.filter((segment) => segment.length > 0);
};

const toRouteFile = (file: string, parts: string[]): RouteFile => {
  const segments = parts.flatMap(splitDots);
  const last = segments[segments.length - 1];
  const kind = last === LAYOUT_SEGMENT ? "layout" : INDEX_SEGMENTS.has(last) ? "index" : "page";
  return { file, segments: kind === "page" ? segments : segments.slice(0, -1), kind };
};

const listRouteFiles = (appDirectory: string, relative: string[], out: RouteFile[]): void => {
  const directory = path.join(appDirectory, ...relative);
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
    if (entry.isDirectory()) {
      listRouteFiles(appDirectory, [...relative, entry.name], out);
    } else if (entry.isFile() && ROUTE_FILE_PATTERN.test(entry.name)) {
      const baseName = entry.name.replace(ROUTE_FILE_PATTERN, "");
      out.push(
        toRouteFile(path.posix.join(...relative, entry.name), [...relative.slice(1), baseName]),
      );
    }
  }
};

const optsOutOfLayout = (segment: string): boolean => segment.endsWith("_") && segment !== "_";

const stripOptOut = (segment: string): string =>
  optsOutOfLayout(segment) ? segment.slice(0, -1) : segment;

/** URL path contributed by one convention segment; null for pathless (`_group`) segments. */
const toUrlSegment = (rawSegment: string): string | null => {
  const segment = stripOptOut(rawSegment);
  if (segment.startsWith("_")) return null;
  const optional = segment.startsWith("(") && segment.endsWith(")");
  const inner = optional ? segment.slice(1, -1) : segment;
  if (inner === PARAM_PREFIX) return "*";
  const name = inner.startsWith(PARAM_PREFIX) ? `:${inner.slice(1)}` : inner;
  return optional ? `${name}?` : name;
};

const toUrlPath = (segments: string[]): string[] =>
  segments.flatMap((segment) => {
    const url = toUrlSegment(segment);
    return url === null ? [] : [url];
  });

const routeId = (segments: string[]): string => segments.map(stripOptOut).join("/");

/**
 * The nearest `_layout` whose folder prefix this route lives under, honouring
 * trailing-underscore opt-outs: a prefix ending in an opted-out segment cannot
 * be the parent.
 */
const findParentLayout = (
  segments: string[],
  layouts: Map<string, RouteNode>,
  isLayout: boolean,
): RouteNode | null => {
  const limit = isLayout ? segments.length - 1 : segments.length;
  for (let length = limit; length > 0; length--) {
    const prefix = segments.slice(0, length);
    if (optsOutOfLayout(prefix[prefix.length - 1])) continue;
    const layout = layouts.get(routeId(prefix));
    if (layout) return layout;
  }
  return null;
};

const toRecord = (node: RouteNode, parentSegments: string[]): RouteRecord => {
  const ownUrl = toUrlPath(node.file.segments).slice(toUrlPath(parentSegments).length);
  const isIndex = node.file.kind === "index";
  return {
    id: routeIdFromFile(node.file.file),
    path: ownUrl.length === 0 ? null : ownUrl.join("/"),
    index: isIndex,
    element: null,
    component: null,
    file: node.file.file,
    children: node.children.map((child) => toRecord(child, node.file.segments)),
    uncertainty: null,
  };
};

/**
 * Reads the route tree `autoRoutes()` would generate for `appDirectory/routes`.
 * The result is a list of top-level routes to nest under `root.tsx`.
 */
export const readAutoRoutes = (
  appDirectory: string,
  routesDirectoryName = "routes",
): RouteRecord[] => {
  const files: RouteFile[] = [];
  listRouteFiles(appDirectory, [routesDirectoryName], files);
  const nodes = files
    .map((file): RouteNode => ({ file, children: [] }))
    .sort((left, right) => left.file.segments.length - right.file.segments.length);
  const layouts = new Map<string, RouteNode>();
  for (const node of nodes) {
    if (node.file.kind === "layout") layouts.set(routeId(node.file.segments), node);
  }
  const roots: RouteNode[] = [];
  for (const node of nodes) {
    const parent = findParentLayout(node.file.segments, layouts, node.file.kind === "layout");
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots.map((node) => toRecord(node, []));
};
