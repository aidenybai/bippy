import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readPackageManifest } from "../package-manifest.js";
import type { ProcessEnvironment } from "../types.js";
import { md4Hex } from "./md4.js";

export const REACT_SCRIPTS_PACKAGE = "react-scripts";

const REACT_APP_VARIABLE = /^REACT_APP_/i;
const STUB_DOMAIN = "https://create-react-app.dev";

/** `react-dev-utils/getPublicUrlOrPath` in development: `PUBLIC_URL` over the manifest `homepage`, always an absolute path ending in `/`. */
const getPublicUrlOrPath = (
  rootDirectory: string,
  environment: ProcessEnvironment | null,
): string => {
  const manifestPath = path.join(rootDirectory, "package.json");
  const homepage = existsSync(manifestPath)
    ? readPackageManifest(manifestPath).homepage
    : undefined;
  const source = environment?.variables.PUBLIC_URL || homepage;
  if (!source) return "/";
  const withTrailingSlash = source.endsWith("/") ? source : `${source}/`;
  return withTrailingSlash.startsWith(".") ? "/" : new URL(withTrailingSlash, STUB_DOMAIN).pathname;
};

const MEDIA_PATH = "static/media/";
const DEFAULT_IMAGE_INLINE_SIZE_LIMIT = "10000";
/** webpack 5's default `output.hashDigestLength`, applied to `[hash]` of an asset module. */
const ASSET_MODULE_HASH_LENGTH = 20;
/** `[hash:8]` in the `url-loader`/`file-loader` names react-scripts 4 and earlier configure. */
const LOADER_HASH_LENGTH = 8;
const FIRST_ASSET_MODULES_MAJOR = 5;
const NON_NUMERIC_HASH_CODE_A = "a".charCodeAt(0);

/** `mime-types` for the images react-scripts inlines: `/\.(bmp|gif|jpe?g|png)$/`, plus the `image/avif` rule of react-scripts 5. */
const INLINABLE_IMAGE_MIME_TYPES = new Map([
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
]);
const AVIF_EXTENSION = ".avif";
const AVIF_MIME_TYPE = "image/avif";
const SVG_EXTENSION = ".svg";

/** webpack's `nonNumericOnlyHash`: a truncated content hash never starts with a digit. */
const toNonNumericOnlyHash = (hash: string, length: number): string => {
  const slice = hash.slice(0, length);
  if (/[^\d]/.test(slice)) return slice;
  return `${String.fromCharCode(NON_NUMERIC_HASH_CODE_A + (Number.parseInt(hash[0], 10) % 6))}${slice.slice(1)}`;
};

interface ReactScriptsAssets {
  /** The URL (or data URL) `import`ing the file evaluates to under `react-scripts start`. */
  getImportedUrl: (filePath: string) => string;
  /** The file the dev server serves at a pathname: an emitted asset or one under `public/`. */
  findServedFile: (pathname: string) => string | null;
}

/**
 * `react-scripts/config/webpack.config.js` in development: images up to
 * `IMAGE_INLINE_SIZE_LIMIT` bytes become data URLs; every other file is copied
 * to `static/media/[name].[hash][ext]` under `publicUrlOrPath`, with webpack 5's
 * 20-character md4 content hash (react-scripts 5), `file-loader`'s full md4 for
 * SVGs it chains `@svgr/webpack` after, and `[hash:8]` from the `url-loader`/
 * `file-loader` rules of earlier majors.
 */
export const createReactScriptsAssets = (
  rootDirectory: string,
  publicDirectory: string,
  environment: ProcessEnvironment | null,
  version: string | null,
): ReactScriptsAssets => {
  const publicUrlOrPath = getPublicUrlOrPath(rootDirectory, environment);
  const major = version === null ? FIRST_ASSET_MODULES_MAJOR : Number(version.split(".")[0]);
  const usesAssetModules = major >= FIRST_ASSET_MODULES_MAJOR;
  const inlineSizeLimit = Number.parseInt(
    environment?.variables.IMAGE_INLINE_SIZE_LIMIT || DEFAULT_IMAGE_INLINE_SIZE_LIMIT,
    10,
  );
  const emitted = new Map<string, string>();
  const getInlinedMimeType = (extension: string): string | undefined =>
    usesAssetModules && extension === AVIF_EXTENSION
      ? AVIF_MIME_TYPE
      : INLINABLE_IMAGE_MIME_TYPES.get(extension);
  const getHashLength = (extension: string): number | null => {
    if (!usesAssetModules) return LOADER_HASH_LENGTH;
    return extension === SVG_EXTENSION ? null : ASSET_MODULE_HASH_LENGTH;
  };
  return {
    getImportedUrl: (filePath) => {
      const content = readFileSync(filePath);
      const extension = path.extname(filePath);
      const mimeType = getInlinedMimeType(extension);
      if (mimeType !== undefined && content.length <= inlineSizeLimit) {
        return `data:${mimeType};base64,${content.toString("base64")}`;
      }
      const hash = md4Hex(content);
      const hashLength = getHashLength(extension);
      const emittedHash = hashLength === null ? hash : toNonNumericOnlyHash(hash, hashLength);
      const pathname = `${publicUrlOrPath}${MEDIA_PATH}${path.basename(filePath, extension)}.${emittedHash}${extension}`;
      emitted.set(pathname, filePath);
      return pathname;
    },
    findServedFile: (pathname) => {
      const emittedFile = emitted.get(pathname);
      if (emittedFile !== undefined) return emittedFile;
      if (!pathname.startsWith(publicUrlOrPath)) return null;
      const publicFile = path.join(publicDirectory, pathname.slice(publicUrlOrPath.length));
      return path.relative(publicDirectory, publicFile).startsWith("..") || !existsSync(publicFile)
        ? null
        : publicFile;
    },
  };
};

/**
 * `getClientEnvironment(publicUrl).raw` of `react-scripts/config/env.js` under
 * `react-scripts start`: the variables its `DefinePlugin` inlines as
 * `process.env.<NAME>` and `InterpolateHtmlPlugin` substitutes for `%NAME%` in
 * `public/index.html`.
 */
export const getReactScriptsClientEnvironment = (
  rootDirectory: string,
  environment: ProcessEnvironment | null,
): Record<string, string | boolean | undefined> => {
  const variables = environment?.variables ?? {};
  const clientEnvironment: Record<string, string | boolean | undefined> = {
    NODE_ENV: "development",
    PUBLIC_URL: getPublicUrlOrPath(rootDirectory, environment).slice(0, -1),
    WDS_SOCKET_HOST: variables.WDS_SOCKET_HOST,
    WDS_SOCKET_PATH: variables.WDS_SOCKET_PATH,
    WDS_SOCKET_PORT: variables.WDS_SOCKET_PORT,
    FAST_REFRESH: variables.FAST_REFRESH !== "false",
  };
  for (const [name, value] of Object.entries(variables)) {
    if (REACT_APP_VARIABLE.test(name)) clientEnvironment[name] = value;
  }
  return clientEnvironment;
};
