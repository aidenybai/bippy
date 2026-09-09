import { exportCapture } from "../observations.js";
import type { CapturedExportReference, CapturedValue } from "../types.js";

/** Looks up the module export a page value is identical to, so captures can name it instead of serializing it. */
export interface ExportIndex {
  find: (value: object) => CapturedValue | undefined;
}

export const NO_EXPORTS: ExportIndex = { find: () => undefined };

const SOURCE_MODULE_PATH = /\.(?:[cm]?[jt]sx?)$/;

// Dev servers serve the app's own modules one per URL under the served root;
// dependencies come pre-bundled (`/node_modules/`, `/@fs/.../node_modules/`)
// and the server's own client modules under `/@`. Only origins the document
// loads module scripts from (an inline one imports from its own origin) are
// ESM dev servers; a classic script (a webpack bundle) is not in the module
// map and would be executed anew if imported.
const moduleScriptOrigins = (): Set<string> => {
  const origins = new Set<string>();
  document
    .querySelectorAll<HTMLScriptElement>("script[type=module]")
    .forEach((script) =>
      origins.add(script.src ? new URL(script.src, location.href).origin : location.origin),
    );
  return origins;
};

const classicScriptUrls = (): Set<string> => {
  const urls = new Set<string>();
  document
    .querySelectorAll<HTMLScriptElement>("script[src]:not([type=module])")
    .forEach((script) => urls.add(new URL(script.src, location.href).href));
  return urls;
};

const isSourceModuleUrl = (url: URL, origins: Set<string>, classicScripts: Set<string>): boolean =>
  origins.has(url.origin) &&
  !classicScripts.has(url.href) &&
  SOURCE_MODULE_PATH.test(url.pathname) &&
  !url.pathname.includes("/node_modules/") &&
  !url.pathname.startsWith("/@");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReferenceable = (value: unknown): value is object =>
  typeof value === "function" || isRecord(value);

/**
 * Indexes the exports of every source module the page loaded, by identity.
 * Importing a URL the page already loaded yields the evaluated module instance,
 * so this runs no module code of its own.
 */
export const readModuleExports = async (): Promise<ExportIndex> => {
  const references = new Map<object, CapturedExportReference>();
  if (typeof performance === "undefined") return NO_EXPORTS;
  const origins = moduleScriptOrigins();
  const classicScripts = classicScriptUrls();
  const hrefs = new Set(
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name, location.href))
      .filter((url) => isSourceModuleUrl(url, origins, classicScripts))
      .map((url) => url.href),
  );
  for (const href of hrefs) {
    const url = new URL(href);
    let namespace: unknown;
    try {
      namespace = await import(/* @vite-ignore */ href);
    } catch {
      continue;
    }
    if (!isRecord(namespace)) continue;
    for (const [name, value] of Object.entries(namespace)) {
      if (isReferenceable(value) && !references.has(value)) {
        references.set(value, { module: url.pathname, name });
      }
    }
  }
  return {
    find: (value) => {
      const reference = references.get(value);
      return reference && exportCapture(reference);
    },
  };
};
