import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import { IMAGE_FILE_PATTERN, stripQuery } from "./packages";

const STYLESHEET_PATTERN = /\.(?:css|scss|sass|less|styl|pcss)(?:\?(?!.*\b(?:raw|url)\b)|$)/;
const STYLESHEET_PREFIX = "\0bippy-verify-stylesheet:";
const STYLESHEET_SOURCE =
  "export default new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) });";
const SVG_COMPONENT_PATTERN = /\.svg\?react$/;
const SVG_FILE_PATTERN = /\.svg$/;
const SVG_COMPONENT_PREFIX = "\0bippy-verify-svg-component:";
const SVG_COMPONENT_SOURCE = [
  'import { createElement } from "react";',
  "export default function SvgComponent({ title, titleId, ...props }) {",
  '  return createElement("svg", props);',
  "}",
].join("\n");
const MISSING_ASSET_PREFIX = "\0bippy-verify-missing-asset:";

export const resolveAssetId = (
  source: string,
  importer: string | undefined,
  isSvgImportedAsComponent: boolean,
): string | null => {
  if (STYLESHEET_PATTERN.test(source)) return `${STYLESHEET_PREFIX}${source}.js`;
  if (isSvgImportedAsComponent && SVG_FILE_PATTERN.test(source))
    return `${SVG_COMPONENT_PREFIX}${source}.js`;
  const assetPath = stripQuery(source);
  const isMissingImage =
    importer !== undefined &&
    assetPath.startsWith(".") &&
    IMAGE_FILE_PATTERN.test(assetPath) &&
    !existsSync(resolve(dirname(stripQuery(importer)), assetPath));
  return isMissingImage ? `${MISSING_ASSET_PREFIX}${assetPath}` : null;
};

export const loadAsset = (id: string): string | null => {
  if (id.startsWith(STYLESHEET_PREFIX)) return STYLESHEET_SOURCE;
  if (SVG_COMPONENT_PATTERN.test(id) || id.startsWith(SVG_COMPONENT_PREFIX))
    return SVG_COMPONENT_SOURCE;
  if (id.startsWith(MISSING_ASSET_PREFIX))
    return `export default ${JSON.stringify(id.slice(MISSING_ASSET_PREFIX.length))};`;
  return null;
};

export const createAssetPlugin = (isSvgImportedAsComponent: boolean): Plugin => ({
  name: "bippy-verify-assets",
  enforce: "pre",
  resolveId: (source, importer) => resolveAssetId(source, importer, isSvgImportedAsComponent),
  load: loadAsset,
});
