import { readdirSync } from "node:fs";
import path from "node:path";
import { type RouteRecord, readNoRouteContent } from "./react-router.js";
import { routeIdFromFile } from "./route-files.js";

// File-convention routes as `remix-flat-routes` (hybrid mode) derives them from
// `app/routes`, mirroring its `getRouteSegments`/`findParentRouteId`:
//
//   a.b.tsx                 dots split segments; `[.]` escapes
//   folder+/                a folder whose name ends in `+` is flattened into
//                           the segments of every file under it
//   folder/route.tsx        a plain folder contributes its name; the file name
//                           is dropped unless it is `route` or `_layout`-like
//   _layout, _index, index  terminators that do not contribute a segment
//   $param, $, ($param)     dynamic, splat, optional segments
//   _group                  pathless segment
//   name_                   trailing underscore opts out of the parent layout
//
// A route nests under the route whose segment list is its longest strict prefix.

export const FLAT_ROUTES_PACKAGE = "remix-flat-routes";
export const ROUTES_OPTION_ADAPTER_PACKAGE = "@react-router/remix-routes-option-adapter";

const NESTED_DIRECTORY_CHAR = "+";
const PARAM_PREFIX = "$";
const ROUTE_MODULE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".md", ".mdx"]);
const NESTED_ROUTE_FILE_PATTERN =
  /((\+[/\\][^/\\:?*]+)|[/\\]((index|route|layout|page)|(_[^/\\:?*]+)|([^/\\:?*]+\.route)))\.(ts|tsx|js|jsx|md|mdx)$/;
const SERVER_FILE_PATTERN = /\.server\.(ts|tsx|js|jsx|md|mdx)$/;
const INDEX_ROUTE_PATTERN = /((^|[.]|[+]\/)(index|_index))(\/[^/]+)?$|(\/_?index\/)/;
const IGNORED_FILE_PATTERN = /(^|\/)\./;

interface FlatRouteInfo {
  id: string;
  file: string;
  segments: string[];
  name: string;
  path: string | undefined;
  index: boolean;
  parentId: string | undefined;
}

const listFiles = (directory: string, base: string, out: string[]): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(filePath, base, out);
    else if (entry.isFile()) out.push(path.relative(base, filePath).split(path.sep).join("/"));
  }
};

const isRouteModuleFile = (file: string): boolean => {
  if (!file.includes("/")) return ROUTE_MODULE_EXTENSIONS.has(path.extname(file));
  return NESTED_ROUTE_FILE_PATTERN.test(file) && !SERVER_FILE_PATTERN.test(file);
};

const isPathSeparator = (character: string): boolean => /[/\\.]/.test(character);

const getRouteSegments = (routeName: string, isIndex: boolean): string[] => {
  let name = routeName.replace(/\+\/_\./g, `_${NESTED_DIRECTORY_CHAR}/`);
  const hasPlus = /\+[/\\]/.test(name);
  if (hasPlus) name = name.replace(/\+[/\\]/g, ".");
  const hasFolder = name.includes("/");
  if (((hasPlus && hasFolder) || !hasPlus) && !name.endsWith(".route")) {
    const lastSlash = name.lastIndexOf("/");
    if (lastSlash >= 0) name = name.slice(0, lastSlash);
  }
  let segments: string[] = [];
  let segment = "";
  let isEscaped = false;
  for (const character of name) {
    if (isPathSeparator(character) && !isEscaped) {
      if (segment) segments.push(segment);
      segment = "";
      continue;
    }
    if (character === "[") isEscaped = true;
    else if (character === "]") isEscaped = false;
    segment += character;
  }
  if (segment) segments.push(segment);
  if (segments.at(-1) === "route") segments = segments.slice(0, -1);
  if (!isIndex && hasPlus && segments.at(-1)?.startsWith("_")) segments = segments.slice(0, -1);
  return segments;
};

const unescapeSegment = (segment: string): string => {
  if (!(segment.includes("[") && segment.includes("]"))) return segment;
  let output = "";
  let depth = 0;
  for (const character of segment) {
    if (character === "[" && depth === 0) depth++;
    else if (character === "]" && depth > 0) depth--;
    else output += character;
  }
  return output;
};

const createRoutePath = (routeSegments: string[], isIndex: boolean): string | undefined => {
  const segments = isIndex ? [...routeSegments.slice(0, -1), ""] : routeSegments;
  let result = "";
  for (const rawSegment of segments) {
    if (rawSegment.startsWith("_")) continue;
    const segment = unescapeSegment(
      rawSegment.endsWith("_") ? rawSegment.slice(0, -1) : rawSegment,
    );
    if (segment.startsWith(PARAM_PREFIX)) {
      result += segment === PARAM_PREFIX ? "/*" : `/:${segment.slice(1)}`;
    } else if (segment.startsWith(`(${PARAM_PREFIX}`)) {
      result += `/:${segment.slice(2, -1)}?`;
    } else if (segment.startsWith("(")) {
      result += `/${segment.slice(1, -1)}?`;
    } else {
      result += `/${segment}`;
    }
  }
  if (result.endsWith("/")) result = result.slice(0, -1);
  return result || undefined;
};

const findParentId = (
  route: FlatRouteInfo,
  byName: Map<string, FlatRouteInfo>,
): string | undefined => {
  let parentName = route.segments.slice(0, -1).join("/");
  while (parentName) {
    const parent = byName.get(parentName);
    if (parent) return parent.id;
    parentName = parentName.slice(0, Math.max(0, parentName.lastIndexOf("/")));
  }
  return undefined;
};

const toRecords = (routes: FlatRouteInfo[], parentId: string | undefined): RouteRecord[] => {
  const parent = routes.find((route) => route.id === parentId);
  const parentPath = parent?.path ?? "/";
  return routes
    .filter((route) => route.parentId === parentId)
    .map((route): RouteRecord => {
      let ownPath = route.path?.slice(parentPath.length) ?? "";
      if (ownPath.startsWith("/")) ownPath = ownPath.slice(1);
      return {
        id: route.id,
        path: ownPath.length === 0 ? null : ownPath,
        index: route.index,
        readContent: readNoRouteContent,
        file: route.file,
        children: route.index ? [] : toRecords(routes, route.id),
        uncertainty: null,
      };
    });
};

/**
 * Reads the route tree `flatRoutes(routesDirectoryName, defineRoutes)` would
 * generate for `appDirectory`. The result is a list of top-level routes to nest
 * under `root.tsx`.
 */
export const readFlatRoutes = (
  appDirectory: string,
  routesDirectoryName = "routes",
): RouteRecord[] => {
  const routesDirectory = path.join(appDirectory, routesDirectoryName);
  const files: string[] = [];
  listFiles(routesDirectory, routesDirectory, files);
  const routes: FlatRouteInfo[] = [];
  const byName = new Map<string, FlatRouteInfo>();
  for (const file of files.sort()) {
    if (IGNORED_FILE_PATTERN.test(file) || !isRouteModuleFile(file)) continue;
    const routeName = routeIdFromFile(file);
    const isIndex = INDEX_ROUTE_PATTERN.test(routeName);
    const segments = getRouteSegments(routeName, isIndex);
    const route: FlatRouteInfo = {
      id: `${routesDirectoryName}/${routeName}`,
      file: `${routesDirectoryName}/${file}`,
      segments,
      name: segments.join("/"),
      path: createRoutePath(segments, isIndex),
      index: isIndex,
      parentId: undefined,
    };
    routes.push(route);
    byName.set(route.name, route);
  }
  for (const route of routes) route.parentId = findParentId(route, byName);
  return toRecords(routes, undefined);
};
