import { join } from "node:path";
import type { Plugin } from "vite";

const STUB_DIRECTORY = join(import.meta.dirname, "../stubs");
const NEXT_FONT_ID = "\0bippy-verify-next-font";
const NEXT_FONT_MODULES = new Set(["next/font/google", "next/font/local"]);
export const NEXT_NAVIGATION_STUB = join(STUB_DIRECTORY, "next-navigation.ts");
export const NEXT_ROUTER_STUB = join(STUB_DIRECTORY, "next-router.ts");
export const STAND_IN_SOURCE = join(STUB_DIRECTORY, "stand-in.ts");
export const SERVER_ONLY_STUB = join(STUB_DIRECTORY, "server-only.ts");
const NEXT_STUBS = new Map([
  ["next/navigation", NEXT_NAVIGATION_STUB],
  ["next/document", join(STUB_DIRECTORY, "next-document.ts")],
  ["next/router", NEXT_ROUTER_STUB],
  ["next/headers", join(STUB_DIRECTORY, "next-headers.ts")],
  ["next/cache", join(STUB_DIRECTORY, "next-cache.ts")],
  ["server-only", SERVER_ONLY_STUB],
]);
const T3_ENV_STUB = join(STUB_DIRECTORY, "t3-env.ts");
const PACKAGE_STUBS = new Map([
  ["@t3-oss/env-nextjs", T3_ENV_STUB],
  ["@t3-oss/env-core", T3_ENV_STUB],
  ["next-intl/server", join(STUB_DIRECTORY, "next-intl-server.ts")],
]);
const NUQS_SERVER_ID = "\0bippy-verify-nuqs-server";
const NUQS_CACHE_STUB = join(STUB_DIRECTORY, "nuqs-cache.ts");

const createNextFontSource = (fontNames: Set<string>): string =>
  [
    'const font = () => ({ className: "", style: { fontFamily: "sans-serif" }, variable: "" });',
    "export default font;",
    ...[...fontNames].map((name) => `export const ${name} = font;`),
  ].join("\n");

export const createStubPlugin = (
  nextDirectory: string | null,
  appImporter: string,
  nextFonts: Set<string>,
): Plugin => ({
  name: "bippy-verify-stubs",
  enforce: "pre",
  resolveId(source, importer) {
    if (nextDirectory && NEXT_FONT_MODULES.has(source)) return NEXT_FONT_ID;
    if (nextDirectory && NEXT_STUBS.has(source)) return NEXT_STUBS.get(source);
    if (PACKAGE_STUBS.has(source)) return PACKAGE_STUBS.get(source);
    if (source !== "nuqs/server") return null;
    return importer === NUQS_SERVER_ID
      ? this.resolve(source, appImporter, { skipSelf: true })
      : NUQS_SERVER_ID;
  },
  load: (id) => {
    if (id === NEXT_FONT_ID) return createNextFontSource(nextFonts);
    if (id === NUQS_SERVER_ID)
      return `export * from "nuqs/server";\nexport { createSearchParamsCache } from ${JSON.stringify(NUQS_CACHE_STUB)};`;
    return null;
  },
});
