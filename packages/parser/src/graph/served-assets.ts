import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { primitiveValue, unknownValue } from "../evaluate/values.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import { readPackageManifest } from "../package-manifest.js";
import type { StaticValue } from "../types.js";

// Vite's dev server hands an imported asset the URL it serves the file at:
// root-relative under the served root, `/@fs/<path>` outside it, and from Vite 6
// a small SVG is inlined as a data URL exactly as at build time. Webpack-style
// bundlers emit content-hashed URLs the source does not decide.

export interface ServedAssetsOptions {
  rootDirectory: string;
  /** The bundler's served root (Vite `root`). */
  servedDirectory: string;
  /** Directory served as-is at the URL root (Vite `publicDir`). */
  publicDirectory: string;
  origin: string | null;
  hasDeclaredDependency: (packageName: string) => boolean;
}

export interface ServedAssets {
  /** The value an `import` of the asset file evaluates to. */
  getImportedUrl: (filePath: string) => StaticValue;
  /** The text served for a same-origin or root-relative URL; `null` when nothing is. */
  read: (url: string) => string | null;
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

const readFileUnder = (directory: string, relativePath: string): string | null => {
  const filePath = path.join(directory, relativePath);
  if (path.relative(directory, filePath).startsWith("..") || !existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
};

const getPathname = (url: string, origin: string | null): string | null => {
  const base = origin ?? "http://origin.invalid";
  if ((origin === null && !url.startsWith("/")) || !URL.canParse(url, base)) return null;
  const parsed = new URL(url, base);
  if (origin !== null && parsed.origin !== origin) return null;
  return decodeURIComponent(parsed.pathname);
};

export const createServedAssets = (options: ServedAssetsOptions): ServedAssets => {
  const { rootDirectory, servedDirectory, publicDirectory, origin } = options;
  const viteMajor = options.hasDeclaredDependency("vite") ? readViteMajor(rootDirectory) : null;
  return {
    getImportedUrl: (filePath) => {
      if (viteMajor === null) {
        return unknownValue(`URL the bundler emits for ${path.basename(filePath)}`);
      }
      const inlined = readInlinedSvg(filePath, viteMajor);
      if (inlined !== null) return primitiveValue(inlined);
      const relativePath = path.relative(servedDirectory, filePath);
      return primitiveValue(
        relativePath.startsWith("..")
          ? `${FS_URL_PREFIX}${toUrlPath(filePath).replace(/^\//, "")}`
          : `/${toUrlPath(relativePath)}`,
      );
    },
    read: (url) => {
      const pathname = getPathname(url, origin);
      if (pathname === null) return null;
      if (pathname.startsWith(FS_URL_PREFIX)) {
        return readFileUnder(path.parse(rootDirectory).root, pathname.slice(FS_URL_PREFIX.length));
      }
      return readFileUnder(publicDirectory, pathname) ?? readFileUnder(servedDirectory, pathname);
    },
  };
};
