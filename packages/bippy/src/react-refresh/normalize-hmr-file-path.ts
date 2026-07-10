import { normalizeFileName } from "../source/get-source.js";

import { BUNDLER_LAYER_PREFIX_REGEX } from "./constants.js";

/**
 * Normalizes a bundler module key or HMR update path into a plain,
 * project-relative file path. Strips URL schemes (via
 * {@link normalizeFileName}), bundler layer prefixes like
 * `(app-pages-browser)/`, and leading `./` segments.
 *
 * @example
 * ```ts
 * normalizeHmrFilePath("(app-pages-browser)/./app/page.tsx");
 * // "app/page.tsx"
 * ```
 */
export const normalizeHmrFilePath = (filePath: string): string => {
  let normalizedFilePath = normalizeFileName(filePath);
  normalizedFilePath = normalizedFilePath.replace(BUNDLER_LAYER_PREFIX_REGEX, "");
  if (normalizedFilePath.startsWith("./")) {
    normalizedFilePath = normalizedFilePath.slice(2);
  }
  return normalizedFilePath;
};
