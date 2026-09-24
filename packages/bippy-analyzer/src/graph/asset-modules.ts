import { readFileSync } from "node:fs";
import path from "node:path";

interface AssetModuleSource {
  moduleKey: string;
  sourceText: string;
}

const RAW_QUERY = /[?&]raw\b/;
const INLINE_QUERY = /[?&]inline\b/;
const CSS_MODULE_FILE = /\.module\.css$/;
/** Plain CSS that Vite serves verbatim: no `@import` inlining, no url rewriting, no preprocessor. */
const BUNDLER_TRANSFORMED_CSS = /@import|url\(|image-set\(/;

const defaultExportOfText = (text: string): string => `export default ${JSON.stringify(text)};`;

/**
 * Vite import queries whose module is a string the bundler derives from the
 * file on disk: `?raw` is the file text, `?inline` on a stylesheet is its CSS.
 */
export const readAssetModuleSource = (
  filePath: string,
  specifier: string,
): AssetModuleSource | null => {
  if (RAW_QUERY.test(specifier)) {
    return {
      moduleKey: `${filePath}?raw`,
      sourceText: defaultExportOfText(readFileSync(filePath, "utf8")),
    };
  }
  if (
    INLINE_QUERY.test(specifier) &&
    path.extname(filePath) === ".css" &&
    !CSS_MODULE_FILE.test(filePath)
  ) {
    const css = readFileSync(filePath, "utf8");
    if (BUNDLER_TRANSFORMED_CSS.test(css)) return null;
    return { moduleKey: `${filePath}?inline`, sourceText: defaultExportOfText(css) };
  }
  return null;
};
