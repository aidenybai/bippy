import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { primitiveValue, unknownValue } from "../evaluate/values.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { readPackageManifest } from "../package-manifest.js";
import type { ModuleBundler, ProcessEnvironment, StaticValue } from "../types.js";
import { createReactScriptsAssets } from "./react-scripts.js";

// Vite's dev server hands an imported asset the URL it serves the file at:
// root-relative under the served root, `/@fs/<path>` outside it, and from Vite 6
// a small SVG is inlined as a data URL exactly as at build time. react-scripts
// emits content-hashed URLs its webpack config decides; other bundlers' URLs
// are not modeled.

export interface ServedAssetsOptions {
  rootDirectory: string;
  /** The bundler's served root (Vite `root`). */
  servedDirectory: string;
  /** Directory served as-is at the URL root (Vite `publicDir`). */
  publicDirectory: string;
  origin: string | null;
  bundler: ModuleBundler;
  environment: ProcessEnvironment | null;
  hasDeclaredDependency: (packageName: string) => boolean;
  readPackageVersion: (packageName: string) => string | null;
}

export interface ServedAssets {
  /** The value an `import` of the asset file evaluates to. */
  getImportedUrl: (filePath: string) => StaticValue;
  /** The file served for a same-origin or root-relative URL; `null` when nothing is. */
  findServedFile: (url: string) => string | null;
}

const FS_URL_PREFIX = "/@fs/";
const DEFAULT_ASSETS_INLINE_LIMIT = 4096;
const FIRST_INLINING_VITE_MAJOR = 6;
const NESTED_QUOTES = /"[^"']*'[^"]*"|'[^'"]*"[^']*'/;

const readViteMajor = (rootDirectory: string): number | null => {
  const manifestPath = getInstalledModules(rootDirectory).resolve("vite/package.json");
  const version = manifestPath === null ? undefined : readPackageManifest(manifestPath).version;
  const major = version === undefined ? null : /^(\d+)\./.exec(version);
  return major === null ? null : Number(major[1]);
};

const svgToDataUrl = (content: Buffer): string => {
  const text = content.toString();
  if (text.includes("<text") || text.includes("<foreignObject") || NESTED_QUOTES.test(text)) {
    return `data:image/svg+xml;base64,${content.toString("base64")}`;
  }
  return (
    "data:image/svg+xml," +
    text
      .trim()
      .replaceAll(/>\s+</g, "><")
      .replaceAll('"', "'")
      .replaceAll("%", "%25")
      .replaceAll("#", "%23")
      .replaceAll("<", "%3c")
      .replaceAll(">", "%3e")
      .replaceAll(/\s+/g, "%20")
  );
};

const readInlinedSvg = (filePath: string, viteMajor: number): string | null => {
  if (viteMajor < FIRST_INLINING_VITE_MAJOR || !filePath.endsWith(".svg") || !existsSync(filePath))
    return null;
  const content = readFileSync(filePath);
  return content.length < DEFAULT_ASSETS_INLINE_LIMIT ? svgToDataUrl(content) : null;
};

const toUrlPath = (relativePath: string): string => relativePath.split(path.sep).join("/");

const findFileUnder = (directory: string, relativePath: string): string | null => {
  const filePath = path.join(directory, relativePath);
  return path.relative(directory, filePath).startsWith("..") || !existsSync(filePath)
    ? null
    : filePath;
};

const getPathname = (url: string, origin: string | null): string | null => {
  const base = origin ?? "http://origin.invalid";
  if ((origin === null && !url.startsWith("/")) || !URL.canParse(url, base)) return null;
  const parsed = new URL(url, base);
  if (origin !== null && parsed.origin !== origin) return null;
  return decodeURIComponent(parsed.pathname);
};

const createViteAssets = (options: ServedAssetsOptions, viteMajor: number): ServedAssets => {
  const { rootDirectory, servedDirectory, publicDirectory } = options;
  return {
    getImportedUrl: (filePath) => {
      const inlined = readInlinedSvg(filePath, viteMajor);
      if (inlined !== null) return primitiveValue(inlined);
      const relativePath = path.relative(servedDirectory, filePath);
      return primitiveValue(
        relativePath.startsWith("..")
          ? `${FS_URL_PREFIX}${toUrlPath(filePath).replace(/^\//, "")}`
          : `/${toUrlPath(relativePath)}`,
      );
    },
    findServedFile: (pathname) => {
      if (pathname.startsWith(FS_URL_PREFIX)) {
        return findFileUnder(path.parse(rootDirectory).root, pathname.slice(FS_URL_PREFIX.length));
      }
      return findFileUnder(publicDirectory, pathname) ?? findFileUnder(servedDirectory, pathname);
    },
  };
};

const createUnmodeledAssets = (options: ServedAssetsOptions): ServedAssets => ({
  getImportedUrl: (filePath) =>
    unknownValue(`URL the bundler emits for ${path.basename(filePath)}`),
  findServedFile: (pathname) =>
    findFileUnder(options.publicDirectory, pathname) ??
    findFileUnder(options.servedDirectory, pathname),
});

const createBundlerAssets = (options: ServedAssetsOptions): ServedAssets => {
  const { rootDirectory, publicDirectory, environment } = options;
  if (options.bundler === "react-scripts") {
    const assets = createReactScriptsAssets(
      rootDirectory,
      publicDirectory,
      environment,
      options.readPackageVersion("react-scripts"),
    );
    return {
      getImportedUrl: (filePath) => primitiveValue(assets.getImportedUrl(filePath)),
      findServedFile: assets.findServedFile,
    };
  }
  const viteMajor = options.hasDeclaredDependency("vite") ? readViteMajor(rootDirectory) : null;
  return viteMajor === null ? createUnmodeledAssets(options) : createViteAssets(options, viteMajor);
};

export const createServedAssets = (options: ServedAssetsOptions): ServedAssets => {
  const assets = createBundlerAssets(options);
  return {
    getImportedUrl: assets.getImportedUrl,
    findServedFile: (url) => {
      const pathname = getPathname(url, options.origin);
      return pathname === null ? null : assets.findServedFile(pathname);
    },
  };
};
