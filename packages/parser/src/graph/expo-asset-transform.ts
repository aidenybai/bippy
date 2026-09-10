import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDefaultExport, getInstalledModules } from "../libraries/installed-modules.js";
import type { AssetTransform } from "../types.js";

/** `metro-config`'s default `resolver.assetExts`: the files Metro hands its asset transformer instead of Babel. */
const METRO_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  "bmp",
  "gif",
  "jpg",
  "jpeg",
  "png",
  "psd",
  "svg",
  "webp",
  "xml",
  "m4v",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
  "aac",
  "aiff",
  "caf",
  "m4a",
  "mp3",
  "wav",
  "html",
  "pdf",
  "yaml",
  "yml",
  "otf",
  "ttf",
  "zip",
]);

/** Metro's `isAssetTypeAnImage`: the asset types whose dimensions it reads with `image-size`. */
const IMAGE_ASSET_TYPES: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "bmp",
  "gif",
  "webp",
  "psd",
  "svg",
  "tiff",
  "ktx",
]);

/** The `transformer.publicPath` `@expo/cli` configures for `expo start`; exports use `/assets?export_path=...` instead. */
const DEV_SERVER_PUBLIC_PATH = "/assets/?unstable_path=.";

/** Metro's `parsePlatformFilePath`: `<base>[.<platform>].<extension>`. */
const PLATFORM_FILE_PATTERN = /^(.+?)(\.([^.]+))?\.([^.]+)$/;

/** Metro's `AssetPaths.parseBaseName`: `<root>[@<scale>x]`. */
const ASSET_BASE_NAME_PATTERN = /(.+?)(@([\d.]+)x)?$/;

/** `@expo/metro-config`'s asset URL query, whose path value it URL-encodes. */
const ASSET_PATH_QUERY_PATTERN = /\?(export_path|unstable_path)=(.*)/;

/** The `require` chain from `@expo/cli` to the `image-size` Metro's `getAssetData` measures images with. */
const IMAGE_SIZE_DEPENDENCY_CHAIN = [
  "@expo/metro-config/package.json",
  "@expo/metro/package.json",
  "metro/package.json",
];

const imageDimensionsSchema = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
});

interface ImageDimensions extends z.infer<typeof imageDimensionsSchema> {}

interface MeasureImage {
  (content: Buffer): ImageDimensions;
}

interface ParsedAssetName {
  name: string;
  type: string;
  scale: number;
}

const toPosixPath = (filePath: string): string => filePath.split(path.sep).join(path.posix.sep);

const parseAssetName = (filePath: string, platform: string): ParsedAssetName | null => {
  const match = path.basename(filePath).match(PLATFORM_FILE_PATTERN);
  if (!match) return null;
  const [, base, , filePlatform, extension] = match;
  const baseName =
    filePlatform === undefined || filePlatform === platform ? base : `${base}.${filePlatform}`;
  const baseMatch = baseName.match(ASSET_BASE_NAME_PATTERN);
  if (!baseMatch) return null;
  const resolution = baseMatch[3] === undefined ? Number.NaN : Number.parseFloat(baseMatch[3]);
  return {
    name: baseMatch[1],
    type: extension,
    scale: Number.isNaN(resolution) ? 1 : resolution,
  };
};

/** Metro's `getAssetData` URL directory, with `@expo/metro-config`'s URL-encoding of the query path. */
const getHttpServerLocation = (localPath: string): string => {
  const directory = path.posix.dirname(toPosixPath(localPath));
  const location = localPath.startsWith("..")
    ? `${DEV_SERVER_PUBLIC_PATH.replace(/\/$/, "")}/${directory}`
    : path.posix.join(DEV_SERVER_PUBLIC_PATH, directory);
  const query = location.match(ASSET_PATH_QUERY_PATTERN);
  return query && query[2] ? location.replace(query[2], encodeURIComponent(query[2])) : location;
};

const loadMeasureImage = (rootDirectory: string, expoCliDirectory: string): MeasureImage | null => {
  const installed = getInstalledModules(rootDirectory);
  let manifestPath = path.join(expoCliDirectory, "package.json");
  for (const specifier of IMAGE_SIZE_DEPENDENCY_CHAIN) {
    const resolved = installed.resolveBeside(specifier, manifestPath);
    if (resolved === null) return null;
    manifestPath = resolved;
  }
  const imageSizeModule = installed.loadBeside("image-size", manifestPath);
  const imageSize = imageSizeModule === null ? null : getDefaultExport(imageSizeModule);
  if (typeof imageSize !== "function") return null;
  return (content) => imageDimensionsSchema.parse(Reflect.apply(imageSize, undefined, [content]));
};

const toNumberLiteral = (value: number | undefined): string =>
  value === undefined ? "undefined" : String(value);

/**
 * `@expo/metro-config`'s `asset-transformer` for web bundles: an asset module
 * is the dev server URL of the file, wrapped in an `ImageSource`-shaped object
 * when Metro could measure the image.
 */
export const getExpoAssetTransform = (
  rootDirectory: string,
  expoCliDirectory: string,
  platform: string,
): AssetTransform | null => {
  if (platform !== "web") return null;
  const measureImage = loadMeasureImage(rootDirectory, expoCliDirectory);
  if (measureImage === null) return null;
  return (filePath) => {
    const extension = path.extname(filePath).slice(1);
    if (!METRO_ASSET_EXTENSIONS.has(extension)) return null;
    const parsed = parseAssetName(filePath, platform);
    if (parsed === null) return null;
    const localPath = path.relative(rootDirectory, filePath);
    const uri = `${getHttpServerLocation(localPath)}/${parsed.name}.${parsed.type}`;
    const dimensions = IMAGE_ASSET_TYPES.has(parsed.type)
      ? measureImage(readFileSync(filePath))
      : null;
    if (
      dimensions === null ||
      (dimensions.width === undefined && dimensions.height === undefined)
    ) {
      return `module.exports = ${JSON.stringify(uri)};`;
    }
    const width = dimensions.width === undefined ? undefined : dimensions.width / parsed.scale;
    const height = dimensions.height === undefined ? undefined : dimensions.height / parsed.scale;
    return `module.exports = { uri: ${JSON.stringify(uri)}, width: ${toNumberLiteral(width)}, height: ${toNumberLiteral(height)}, toString() { return this.uri } };`;
  };
};
