import { HMR_SOURCE_FILE_EXTENSION_REGEX } from "./constants.js";
import { normalizeHmrFilePath } from "./normalize-hmr-file-path.js";
import { HmrTransport, HmrUpdateHandler } from "./types.js";

interface WebpackHotUpdateGlobal {
  (chunkId: unknown, updatedModules: Record<string, unknown> | undefined, runtime: unknown): void;
}

declare global {
  interface Window {
    webpackHotUpdate_N_E?: WebpackHotUpdateGlobal;
  }
}

/**
 * Normalizes webpack hot-update module keys into project-relative source
 * file paths, dropping node_modules entries and non-source keys (e.g.
 * webpack runtime helpers).
 *
 * @example
 * ```ts
 * normalizeWebpackModulePaths(["(app-pages-browser)/./app/page.tsx"]);
 * // ["app/page.tsx"]
 * ```
 */
export const normalizeWebpackModulePaths = (moduleKeys: string[]): string[] => {
  const filePaths: string[] = [];
  for (const moduleKey of moduleKeys) {
    if (moduleKey.includes("node_modules")) continue;
    const filePath = normalizeHmrFilePath(moduleKey);
    if (!HMR_SOURCE_FILE_EXTENSION_REGEX.test(filePath)) continue;
    filePaths.push(filePath);
  }
  return filePaths;
};

/**
 * Subscribes to Next.js webpack hot updates by wrapping the
 * `webpackHotUpdate_N_E` global and invokes `onHmrUpdate` with the updated
 * file paths. Returns `null` when the page is not a Next.js webpack dev
 * build.
 *
 * @example
 * ```ts
 * const transport = createNextWebpackHmrTransport((filePaths) => {
 *   console.log("hot updated:", filePaths);
 * });
 * transport?.dispose();
 * ```
 */
export const createNextWebpackHmrTransport = (
  onHmrUpdate: HmrUpdateHandler,
): HmrTransport | null => {
  if (typeof window === "undefined") return null;
  const originalHotUpdate = window.webpackHotUpdate_N_E;
  if (typeof originalHotUpdate !== "function") return null;

  const wrappedHotUpdate: WebpackHotUpdateGlobal = (chunkId, updatedModules, runtime) => {
    const filePaths = normalizeWebpackModulePaths(Object.keys(updatedModules ?? {}));
    if (filePaths.length > 0) onHmrUpdate(filePaths);
    originalHotUpdate(chunkId, updatedModules, runtime);
  };
  window.webpackHotUpdate_N_E = wrappedHotUpdate;

  return {
    dispose: () => {
      if (window.webpackHotUpdate_N_E === wrappedHotUpdate) {
        window.webpackHotUpdate_N_E = originalHotUpdate;
      }
    },
  };
};
