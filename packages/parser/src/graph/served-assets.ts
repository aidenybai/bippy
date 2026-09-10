import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { lookup as lookupMimeType } from "mrmime";
import { branchValue, primitiveValue, unknownValue } from "../evaluate/values.js";
import type { ModuleBundler, ProcessEnvironment, ServedRequest, StaticValue } from "../types.js";
import { createReactScriptsAssets } from "./react-scripts.js";
import type { ViteAppType } from "./vite-config.js";

// Vite's dev server hands an imported asset the URL it serves the file at
// (`fileToDevUrl`): root-relative under the served root, `/@fs/<path>` outside
// it, under the configured base, keeping the import's query. From Vite 6 an
// `?inline` import, or an SVG `build.assetsInlineLimit` admits (`shouldInline`),
// is a data URL exactly as at build time. react-scripts emits content-hashed
// URLs its webpack config decides; other bundlers' URLs are not modeled.
//
// A GET nothing serves is answered by Vite's `htmlFallbackMiddleware` when the
// request accepts HTML (an absent `Accept` counts as `*/*`): `<path>.html` or
// `<path>/index.html` when that file exists, else under `appType: "spa"` the
// root `index.html`, as long as no `server.proxy` context claims the URL first.

interface ServedAssetsOptions {
  rootDirectory: string;
  /** The bundler's served root (Vite `root`). */
  servedDirectory: string;
  /** Directory served as-is at the URL root (Vite `publicDir`); null when disabled. */
  publicDirectory: string | null;
  /** Public base path URLs are served under (Vite `base`). */
  base: string;
  origin: string | null;
  bundler: ModuleBundler;
  environment: ProcessEnvironment | null;
  /** The installed Vite's version; null when Vite does not serve the project. */
  viteVersion: string | null;
  readPackageVersion: (packageName: string) => string | null;
  /** Whether the configured `build.assetsInlineLimit` inlines a file; null when it does not decide statically. */
  shouldInlineAsset: (filePath: string, content: Buffer) => boolean | null;
  appType: ViteAppType;
  /** `server.proxy` contexts; null when the config leaves them undecided. */
  proxyContexts: string[] | null;
}

interface ServedAssets {
  /** The value an `import` of the asset file evaluates to, given the import's original specifier. */
  getImportedUrl: (filePath: string, specifier: string) => StaticValue;
  /** The file served for a same-origin or root-relative URL; `null` when nothing is. A `request` lets an unmatched GET fall back to the page served to HTML-accepting requests. */
  findServedFile: (url: string, request?: ServedRequest) => string | null;
}

const FS_URL_PREFIX = "/@fs/";
const FIRST_INLINING_VITE_MAJOR = 6;
const NESTED_QUOTES = /"[^"']*'[^"]*"|'[^'"]*"[^']*'/;
const POSTFIX = /[?#].*$/;
const URL_QUERY = /(\?|&)url(?:&|$)/;
const TRAILING_QUERY_SEPARATOR = /[?&]$/;
const INLINE_QUERY = /[?&]inline\b/;
const NO_INLINE_QUERY = /[?&]no-inline\b/;
const DEFAULT_MIME_TYPE = "application/octet-stream";
const INDEX_HTML = "index.html";
const FAVICON_PATH = "/favicon.ico";

const acceptsHtml = (request: ServedRequest): boolean =>
  request.accept === undefined ||
  request.accept === "" ||
  request.accept.includes("text/html") ||
  request.accept.includes("*/*");

/** `doesProxyContextMatchUrl`: a `^` context is a pattern, any other a prefix. */
const isProxied = (contexts: string[], url: string): boolean =>
  contexts.some((context) =>
    context.startsWith("^") ? new RegExp(context).test(url) : url.startsWith(context),
  );

/** Vite's `removeUrlQuery`: the `?url` marker is dropped from the postfix the served URL keeps. */
const getPostfix = (specifier: string): string =>
  (POSTFIX.exec(specifier)?.[0] ?? "")
    .replace(URL_QUERY, "$1")
    .replace(TRAILING_QUERY_SEPARATOR, "");

const readMajor = (version: string | null): number | null => {
  const major = version === null ? null : /^(\d+)\./.exec(version);
  return major === null ? null : Number(major[1]);
};

const isSvgFile = (filePath: string): boolean => filePath.endsWith(".svg");

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

const assetToDataUrl = (filePath: string, content: Buffer): string =>
  isSvgFile(filePath)
    ? svgToDataUrl(content)
    : `data:${lookupMimeType(filePath) ?? DEFAULT_MIME_TYPE};base64,${content.toString("base64")}`;

const toUrlPath = (relativePath: string): string => relativePath.split(path.sep).join("/");

const joinUrlSegments = (base: string, url: string): string =>
  `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;

const findFileUnder = (directory: string | null, relativePath: string): string | null => {
  if (directory === null) return null;
  const filePath = path.join(directory, relativePath);
  return path.relative(directory, filePath).startsWith("..") ||
    !existsSync(filePath) ||
    !statSync(filePath).isFile()
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
  const { rootDirectory, servedDirectory, publicDirectory, base, proxyContexts } = options;
  const decodedBase = decodeURI(base);
  const basePrefix = joinUrlSegments(decodedBase, "");
  const getServedUrl = (filePath: string, postfix: string): string => {
    const relativePath = path.relative(servedDirectory, filePath);
    const servedPath = relativePath.startsWith("..")
      ? `${FS_URL_PREFIX}${toUrlPath(filePath).replace(/^\//, "")}`
      : `/${toUrlPath(relativePath)}`;
    return `${joinUrlSegments(decodedBase, servedPath)}${postfix}`;
  };
  /** `shouldInline` for an SVG: `?no-inline` and fragment ids opt out before the configured limit decides. */
  const shouldInlineSvg = (filePath: string, id: string, content: Buffer): boolean | null =>
    NO_INLINE_QUERY.test(id) || id.includes("#")
      ? false
      : options.shouldInlineAsset(filePath, content);
  return {
    getImportedUrl: (filePath, specifier) => {
      const postfix = getPostfix(specifier);
      const id = `${filePath}${postfix}`;
      const servedUrl = primitiveValue(getServedUrl(filePath, postfix));
      const isInlineCandidate = INLINE_QUERY.test(id) || isSvgFile(filePath);
      if (viteMajor < FIRST_INLINING_VITE_MAJOR || !isInlineCandidate || !existsSync(filePath)) {
        return servedUrl;
      }
      const content = readFileSync(filePath);
      const dataUrl = primitiveValue(assetToDataUrl(filePath, content));
      if (INLINE_QUERY.test(id)) return dataUrl;
      const isInlined = shouldInlineSvg(filePath, id, content);
      if (isInlined !== null) return isInlined ? dataUrl : servedUrl;
      return branchValue(
        [dataUrl, servedUrl],
        `whether build.assetsInlineLimit inlines ${path.basename(filePath)}`,
        null,
      );
    },
    findServedFile: (pathname, request) => {
      if (!pathname.startsWith(basePrefix)) return null;
      if (proxyContexts !== null && isProxied(proxyContexts, pathname)) return null;
      const servedPath = pathname.slice(basePrefix.length - 1);
      if (servedPath.startsWith(FS_URL_PREFIX)) {
        return findFileUnder(
          path.parse(rootDirectory).root,
          servedPath.slice(FS_URL_PREFIX.length),
        );
      }
      const served =
        findFileUnder(publicDirectory, servedPath) ?? findFileUnder(servedDirectory, servedPath);
      if (served !== null || request === undefined || proxyContexts === null) return served;
      if (!acceptsHtml(request) || servedPath === FAVICON_PATH) return null;
      const htmlPath = servedPath.endsWith("/")
        ? `${servedPath}${INDEX_HTML}`
        : `${servedPath}.html`;
      return (
        findFileUnder(servedDirectory, htmlPath) ??
        (options.appType === "spa" ? findFileUnder(servedDirectory, INDEX_HTML) : null)
      );
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
  if (options.bundler === "react-scripts" && publicDirectory !== null) {
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
  const viteMajor = readMajor(options.viteVersion);
  return viteMajor === null ? createUnmodeledAssets(options) : createViteAssets(options, viteMajor);
};

export const createServedAssets = (options: ServedAssetsOptions): ServedAssets => {
  const assets = createBundlerAssets(options);
  return {
    getImportedUrl: assets.getImportedUrl,
    findServedFile: (url, request) => {
      const pathname = getPathname(url, options.origin);
      return pathname === null ? null : assets.findServedFile(pathname, request);
    },
  };
};
