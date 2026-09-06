import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const ROUTE_FILE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".mts"] as const;

/** Resolves `directory/baseName.<ext>` for the first extension that exists. */
export const findRouteFile = (directory: string, baseName: string): string | null => {
  for (const extension of ROUTE_FILE_EXTENSIONS) {
    const candidate = path.join(directory, `${baseName}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

export const findFirstDirectory = (rootDirectory: string, candidates: string[]): string | null => {
  for (const candidate of candidates) {
    const directory = path.join(rootDirectory, candidate);
    if (existsSync(directory) && statSync(directory).isDirectory()) return directory;
  }
  return null;
};

export const listSubdirectories = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/** Base names (extension stripped) of route files in `directory`, deduplicated across extensions. */
export const listRouteFileBaseNames = (directory: string): string[] => {
  const baseNames = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name);
    if (!ROUTE_FILE_EXTENSIONS.some((known) => known === extension)) continue;
    baseNames.add(entry.name.slice(0, entry.name.length - extension.length));
  }
  return [...baseNames].sort();
};

export const splitPathname = (pathname: string): string[] =>
  pathname.split("/").filter((segment) => segment.length > 0);

export type DynamicSegment =
  | { kind: "static"; name: string }
  | { kind: "dynamic"; param: string }
  | { kind: "catch-all"; param: string; optional: boolean };

/** Classifies a file-system segment name using Next.js bracket conventions (`[id]`, `[...slug]`, `[[...slug]]`). */
export const classifySegment = (name: string): DynamicSegment => {
  const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(name);
  if (optionalCatchAll) return { kind: "catch-all", param: optionalCatchAll[1], optional: true };
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(name);
  if (catchAll) return { kind: "catch-all", param: catchAll[1], optional: false };
  const dynamic = /^\[(.+)\]$/.exec(name);
  if (dynamic) return { kind: "dynamic", param: dynamic[1] };
  return { kind: "static", name };
};

/**
 * Orders candidate directory names the way Next.js resolves ambiguity: static
 * segments win over dynamic ones, which win over catch-alls.
 */
export const segmentSpecificity = (segment: DynamicSegment): number => {
  switch (segment.kind) {
    case "static":
      return 0;
    case "dynamic":
      return 1;
    case "catch-all":
      return segment.optional ? 3 : 2;
  }
};
