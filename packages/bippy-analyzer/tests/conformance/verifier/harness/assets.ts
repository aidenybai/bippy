import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import { IMAGE_FILE_PATTERN, stripQuery } from "./packages";

const STYLESHEET_PATTERN = /\.(?:css|scss|sass|less|styl|pcss)(?:\?(?!.*\b(?:raw|url)\b)|$)/;
const STYLESHEET_PREFIX = "\0bippy-verify-stylesheet:";
const STYLESHEET_SOURCE =
  "export default new Proxy({}, { get: (target, key) => (typeof key === 'string' && !(key in target) ? key : Reflect.get(target, key)) });";
const SVG_COMPONENT_PATTERN = /\.svg\?react$/;
const SVG_FILE_PATTERN = /\.svg$/;
const SVG_COMPONENT_PREFIX = "\0bippy-verify-svg-component:";
const HTML_TEMPLATE_PATTERN = /^\.{1,2}\/.*\.html$/;
const HTML_TEMPLATE_PREFIX = "\0bippy-verify-html-template:";
const SVG_COMPONENT_SOURCE = [
  'import { createElement } from "react";',
  "export default function SvgComponent({ title, titleId, ...props }) {",
  '  return createElement("svg", props);',
  "}",
].join("\n");
const MISSING_ASSET_PREFIX = "\0bippy-verify-missing-asset:";
const WORKER_FILE_PATTERN = /^\.{1,2}\/.*\.worker\.[cm]?[jt]sx?$/;

const DOT_SEGMENT_PATTERN = /(^|\/)\.\.?(?=\/)/g;

const toVirtualPath = (source: string): string => source.replace(DOT_SEGMENT_PATTERN, "$1_");

export const resolveAssetId = (
  source: string,
  importer: string | undefined,
  isSvgImportedAsComponent: boolean,
): string | null => {
  if (STYLESHEET_PATTERN.test(source)) return `${STYLESHEET_PREFIX}${toVirtualPath(source)}.js`;
  if (isSvgImportedAsComponent && SVG_FILE_PATTERN.test(source))
    return `${SVG_COMPONENT_PREFIX}${toVirtualPath(source)}.js`;
  const assetPath = stripQuery(source);
  if (importer !== undefined && HTML_TEMPLATE_PATTERN.test(assetPath))
    return `${HTML_TEMPLATE_PREFIX}${resolve(dirname(stripQuery(importer)), assetPath)}`;
  const isMissingImage =
    importer !== undefined &&
    assetPath.startsWith(".") &&
    IMAGE_FILE_PATTERN.test(assetPath) &&
    !existsSync(resolve(dirname(stripQuery(importer)), assetPath));
  return isMissingImage ? `${MISSING_ASSET_PREFIX}${assetPath}` : null;
};

const loadHtmlTemplate = (templatePath: string): string =>
  `export default ${JSON.stringify(existsSync(templatePath) ? readFileSync(templatePath, "utf8") : "")};`;

export const loadAsset = (id: string): string | null => {
  if (id.startsWith(STYLESHEET_PREFIX)) return STYLESHEET_SOURCE;
  if (SVG_COMPONENT_PATTERN.test(id) || id.startsWith(SVG_COMPONENT_PREFIX))
    return SVG_COMPONENT_SOURCE;
  if (id.startsWith(HTML_TEMPLATE_PREFIX))
    return loadHtmlTemplate(id.slice(HTML_TEMPLATE_PREFIX.length));
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

export const toWorkerImport = (source: string): string | null =>
  WORKER_FILE_PATTERN.test(source) ? `${source}?worker` : null;

export const createWorkerImportPlugin = (): Plugin => ({
  name: "bippy-verify-worker-imports",
  enforce: "pre",
  async resolveId(source, importer) {
    const workerSource = toWorkerImport(source);
    return workerSource ? this.resolve(workerSource, importer, { skipSelf: true }) : null;
  },
});
