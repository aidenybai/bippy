import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RouteRecord } from "./react-router.js";

// Mirrors `flatRoutesUniversal` from `@react-router/fs-routes` / `@remix-run/dev`.

export const FS_ROUTES_PACKAGE = "@react-router/fs-routes";

const ROUTE_MODULE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".md", ".mdx"];
const PARAM_PREFIX = "$";
const INDEX_SUFFIX = "_index";

interface FlatRouteEntry {
  id: string;
  file: string;
  path: string | undefined;
  index: boolean;
  parentId: string | null;
}

const isIgnored = (relativeFile: string): boolean =>
  relativeFile.split("/").some((segment) => segment.startsWith("."));

const findFile = (directory: string, baseName: string): string | null => {
  for (const extension of ROUTE_MODULE_EXTENSIONS) {
    const candidate = path.join(directory, `${baseName}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const listRouteModules = (appDirectory: string, routesDirectory: string): string[] => {
  const modules: string[] = [];
  for (const entry of readdirSync(routesDirectory, { withFileTypes: true })) {
    const entryPath = path.join(routesDirectory, entry.name);
    if (isIgnored(path.relative(appDirectory, entryPath).split(path.sep).join("/"))) continue;
    if (entry.isFile()) modules.push(entryPath);
    else if (entry.isDirectory()) {
      const module = findFile(entryPath, "route") ?? findFile(entryPath, "index");
      if (module) modules.push(module);
    }
  }
  return modules;
};

interface RouteSegments {
  segments: string[];
  rawSegments: string[];
}

type SegmentState = "normal" | "escape" | "optional" | "optional-escape";

const isSegmentSeparator = (character: string): boolean => character === "/" || character === ".";

const readRouteSegments = (routeId: string): RouteSegments => {
  const segments: string[] = [];
  const rawSegments: string[] = [];
  let segment = "";
  let rawSegment = "";
  let state: SegmentState = "normal";
  const pushSegment = (): void => {
    if (segment) {
      segments.push(segment);
      rawSegments.push(rawSegment);
    }
    segment = "";
    rawSegment = "";
  };
  const pushParam = (index: number): void => {
    segment += index === routeId.length ? "*" : ":";
    rawSegment += PARAM_PREFIX;
  };
  for (let index = 0; index < routeId.length;) {
    const character = routeId[index];
    index++;
    switch (state) {
      case "normal":
        if (isSegmentSeparator(character)) pushSegment();
        else if (character === "[") {
          state = "escape";
          rawSegment += character;
        } else if (character === "(") {
          state = "optional";
          rawSegment += character;
        } else if (!segment && character === PARAM_PREFIX) pushParam(index);
        else {
          segment += character;
          rawSegment += character;
        }
        break;
      case "escape":
        if (character === "]") state = "normal";
        else segment += character;
        rawSegment += character;
        break;
      case "optional":
        if (character === ")") {
          segment += "?";
          rawSegment += character;
          state = "normal";
        } else if (character === "[") {
          state = "optional-escape";
          rawSegment += character;
        } else if (!segment && character === PARAM_PREFIX) pushParam(index);
        else {
          segment += character;
          rawSegment += character;
        }
        break;
      case "optional-escape":
        if (character === "]") state = "optional";
        else segment += character;
        rawSegment += character;
        break;
    }
  }
  pushSegment();
  return { segments, rawSegments };
};

const createRoutePath = (
  { segments, rawSegments }: RouteSegments,
  isIndex: boolean,
): string | undefined => {
  const result: string[] = [];
  const pathSegments = isIndex ? segments.slice(0, -1) : segments;
  for (const [index, segment] of pathSegments.entries()) {
    const rawSegment = rawSegments[index];
    if (segment.startsWith("_") && rawSegment.startsWith("_")) continue;
    result.push(segment.endsWith("_") && rawSegment.endsWith("_") ? segment.slice(0, -1) : segment);
  }
  return result.length > 0 ? result.join("/") : undefined;
};

const isPathlessLayout = (routeId: string, prefix: string): boolean => {
  const lastSegment =
    routeId
      .slice(prefix.length + 1)
      .split(".")
      .pop() ?? "";
  return lastSegment.startsWith("_") && lastSegment !== INDEX_SUFFIX;
};

const findParentId = (routeId: string, routeIds: string[]): string | null => {
  let parentId: string | null = null;
  for (const candidate of routeIds) {
    if (candidate.length >= routeId.length || !routeId.startsWith(candidate)) continue;
    if (![".", "/"].includes(routeId.charAt(candidate.length))) continue;
    if (parentId === null || candidate.length > parentId.length) parentId = candidate;
  }
  return parentId;
};

const toRecords = (entries: FlatRouteEntry[], parentId: string | null): RouteRecord[] =>
  entries
    .filter((entry) => entry.parentId === parentId)
    .map((entry): RouteRecord => ({
      id: entry.id,
      path: entry.path ?? null,
      index: entry.index,
      element: null,
      component: null,
      file: entry.file,
      children: toRecords(entries, entry.id),
      uncertainty: null,
    }));

export const readFsRoutes = (
  appDirectory: string,
  routesDirectoryName = "routes",
): RouteRecord[] => {
  const routesDirectory = path.join(appDirectory, routesDirectoryName);
  if (!existsSync(routesDirectory)) return [];
  const toPosix = (file: string): string => file.split(path.sep).join("/");
  const byId = new Map<string, string>();
  for (const module of listRouteModules(appDirectory, routesDirectory)) {
    const isTopLevelFile = path.dirname(module) === routesDirectory;
    const id = toPosix(
      isTopLevelFile
        ? path.relative(appDirectory, module).slice(0, -path.extname(module).length)
        : path.relative(appDirectory, path.dirname(module)),
    );
    if (!byId.has(id)) byId.set(id, toPosix(path.relative(appDirectory, module)));
  }
  const sortedIds = [...byId.keys()].sort((left, right) => right.length - left.length);
  const entries: FlatRouteEntry[] = sortedIds.map((id) => {
    const isIndex = id.endsWith(INDEX_SUFFIX);
    return {
      id,
      file: byId.get(id) ?? id,
      path: createRoutePath(readRouteSegments(id.slice(routesDirectoryName.length + 1)), isIndex),
      index: isIndex,
      parentId: findParentId(id, sortedIds),
    };
  });
  const fullPaths = new Map(entries.map((entry) => [entry.id, entry.path]));
  const claimedPaths = new Set<string>();
  const kept: FlatRouteEntry[] = [];
  for (const entry of entries) {
    const fullPath = fullPaths.get(entry.id);
    const parentPath = entry.parentId === null ? undefined : fullPaths.get(entry.parentId);
    if (parentPath && entry.path) {
      entry.path =
        entry.path.slice(parentPath.length).replace(/^\//, "").replace(/\/$/, "") || undefined;
    }
    if (!isPathlessLayout(entry.id, routesDirectoryName) && (fullPath || entry.index)) {
      const conflictKey = `${fullPath ?? ""}${entry.index ? "?index" : ""}`;
      if (claimedPaths.has(conflictKey)) continue;
      claimedPaths.add(conflictKey);
    }
    kept.push(entry);
  }
  return toRecords(kept, null);
};
