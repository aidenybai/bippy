import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDefaultExport, getInstalledModules } from "../libraries/installed-modules.js";
import type { AssetTransform } from "../types.js";

const WEBPACK_CONFIG_MANIFEST = "@expo/webpack-config/package.json";

/** `@expo/webpack-config`'s `web-default/index.html`, the template a project's `web/index.html` overrides. */
const TEMPLATE_INDEX_HTML = "web-default/index.html";
const PROJECT_TEMPLATE_FOLDER = "web";

/**
 * `@expo/webpack-config`'s `fallbackLoaderRule` is the last rule, so its
 * `asset/resource` type wins over the image rules' `asset`: every file it does
 * not exclude is emitted as a file. CSS goes through its style loaders first,
 * so the emitted file is not the stylesheet.
 */
const NON_ASSET_FILE_PATTERN = /\.(js|mjs|jsx|ts|tsx|html|json|css)$/;

/** `output.assetModuleFilename` (`static/media/[name].[hash][ext]`) under webpack's default `md4` hash cut to `hashDigestLength` 20. */
const ASSET_DIRECTORY = "static/media";
const HASH_FUNCTION = "md4";
const HASH_DIGEST_LENGTH = 20;

/** `getPublicPaths` for a development build. */
const DEV_SERVER_PUBLIC_PATH = "/";

const LETTER_A_CODE = "a".charCodeAt(0);

interface WebpackHash {
  update(content: Buffer): unknown;
  digest(encoding: string): string;
}

const webpackHashSchema = z.custom<WebpackHash>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "update" in value &&
    typeof value.update === "function" &&
    "digest" in value &&
    typeof value.digest === "function",
);

/** webpack's `nonNumericOnlyHash`: the digest slice, with a letter in front when it is all digits. */
const toContentHash = (fullContentHash: string): string => {
  const slice = fullContentHash.slice(0, HASH_DIGEST_LENGTH);
  if (/[^\d]/.test(slice)) return slice;
  const letter = String.fromCharCode(LETTER_A_CODE + (Number.parseInt(fullContentHash[0], 10) % 6));
  return `${letter}${slice.slice(1)}`;
};

/** The page `@expo/webpack-config` serves: the project's `web/index.html`, else its own template. */
export const readExpoWebpackDocumentShell = (rootDirectory: string): string | null => {
  const projectIndex = path.join(rootDirectory, PROJECT_TEMPLATE_FOLDER, "index.html");
  if (existsSync(projectIndex)) return readFileSync(projectIndex, "utf8");
  const manifestPath = getInstalledModules(rootDirectory).resolve(WEBPACK_CONFIG_MANIFEST);
  if (manifestPath === null) return null;
  const templateIndex = path.join(path.dirname(manifestPath), TEMPLATE_INDEX_HTML);
  return existsSync(templateIndex) ? readFileSync(templateIndex, "utf8") : null;
};

/** webpack 5's asset modules under `@expo/webpack-config`: an asset module is the dev server URL of the content-hashed file. */
export const getExpoWebpackAssetTransform = (rootDirectory: string): AssetTransform | null => {
  const installed = getInstalledModules(rootDirectory);
  const manifestPath = installed.resolve(WEBPACK_CONFIG_MANIFEST);
  if (manifestPath === null) return null;
  const createHashModule = installed.loadBeside("webpack/lib/util/createHash", manifestPath);
  const createHash = createHashModule === null ? null : getDefaultExport(createHashModule);
  if (typeof createHash !== "function") return null;
  return (filePath) => {
    if (NON_ASSET_FILE_PATTERN.test(filePath)) return null;
    const hash = webpackHashSchema.parse(Reflect.apply(createHash, undefined, [HASH_FUNCTION]));
    hash.update(readFileSync(filePath));
    const contentHash = toContentHash(z.string().parse(hash.digest("hex")));
    const extension = path.extname(filePath);
    const fileName = `${path.basename(filePath, extension)}.${contentHash}${extension}`;
    return `module.exports = ${JSON.stringify(`${DEV_SERVER_PUBLIC_PATH}${ASSET_DIRECTORY}/${fileName}`)};`;
  };
};
