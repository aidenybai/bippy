import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Plugin } from "vite";
import { IMAGE_FILE_PATTERN } from "./packages";
import type { ProviderSpec } from "./providers";
import { NEXT_NAVIGATION_STUB, NEXT_ROUTER_STUB } from "./stubs";

const NEXT_NODE_POLYFILLS: Record<string, string> = {
  assert: "assert",
  buffer: "buffer",
  constants: "constants-browserify",
  crypto: "crypto-browserify",
  domain: "domain-browser",
  events: "events",
  http: "stream-http",
  https: "https-browserify",
  os: "os-browserify",
  path: "path-browserify",
  punycode: "punycode",
  querystring: "querystring-es3",
  stream: "stream-browserify",
  string_decoder: "string_decoder",
  sys: "util",
  timers: "timers-browserify",
  tty: "tty-browserify",
  util: "util",
  vm: "vm-browserify",
  zlib: "browserify-zlib",
};
const NEXT_CONTEXT_MODULES = ["app-router-context", "hooks-client-context", "router-context"];

export const getPolyfilledModules = (nextDirectory: string | null): Set<string> =>
  new Set(nextDirectory ? Object.keys(NEXT_NODE_POLYFILLS) : []);

export const getNextPolyfillAliases = (
  nextDirectory: string | null,
): Array<{ find: RegExp; replacement: string }> => {
  if (!nextDirectory) return [];
  return Object.entries(NEXT_NODE_POLYFILLS).flatMap(([name, polyfill]) => {
    const directory = join(nextDirectory, "dist/compiled", polyfill);
    return existsSync(directory)
      ? [{ find: new RegExp(`^(?:node:)?${name}/?$`), replacement: `${directory}/` }]
      : [];
  });
};

// HACK: named with `.shared-runtime` since Next 13.5.
const resolveNextContextModule = (nextDirectory: string, name: string): string | null => {
  const fileName = [`${name}.shared-runtime`, name].find((candidate) =>
    existsSync(join(nextDirectory, "dist/shared/lib", `${candidate}.js`)),
  );
  return fileName ? `next/dist/shared/lib/${fileName}` : null;
};

// HACK: packages importing `next/navigation` or `next/router` bypass the stubs, so provide Next's
// own router contexts.
export const createNextContextSpec = (nextDirectory: string | null): ProviderSpec | null => {
  if (!nextDirectory) return null;
  const [appRouterModule, hooksModule, routerModule] = NEXT_CONTEXT_MODULES.map((name) =>
    resolveNextContextModule(nextDirectory, name),
  );
  if (!appRouterModule || !hooksModule || !routerModule) return null;
  return {
    packageName: "next",
    modules: [appRouterModule, hooksModule, routerModule],
    imports: [
      `import * as AppRouterContexts from ${JSON.stringify(appRouterModule)};`,
      `import * as HookContexts from ${JSON.stringify(hooksModule)};`,
      `import * as RouterContexts from ${JSON.stringify(routerModule)};`,
      `import { appRouter } from ${JSON.stringify(NEXT_NAVIGATION_STUB)};`,
      `import pagesRouter from ${JSON.stringify(NEXT_ROUTER_STUB)};`,
      "const provide = (context, value, children) => context ? createElement(context.Provider, { value }, children) : children;",
    ].join("\n"),
    wrap: (children) =>
      [
        "provide(AppRouterContexts.AppRouterContext, appRouter,",
        'provide(HookContexts.PathnameContext, "/",',
        "provide(HookContexts.SearchParamsContext, new URLSearchParams(),",
        "provide(HookContexts.PathParamsContext ?? HookContexts.ParamsContext, {},",
        `provide(RouterContexts.RouterContext, pagesRouter, ${children})))))`,
      ].join(" "),
  };
};

// HACK: unoptimized, since the harness has no `/_next/image` route.
export const getNextImageOptions = (nextDirectory: string | null): Record<string, unknown> => {
  const configFile = nextDirectory && join(nextDirectory, "dist/shared/lib/image-config.js");
  if (!configFile || !existsSync(configFile)) return {};
  const { imageConfigDefault }: { imageConfigDefault: object } =
    createRequire(configFile)(configFile);
  return { __NEXT_IMAGE_OPTS: { ...imageConfigDefault, unoptimized: true } };
};

// HACK: `next/image` reads `{ src, width, height }` the way Next's bundler gives it, where Vite
// gives only a URL.
export const createNextImagePlugin = (): Plugin => ({
  name: "bippy-verify-next-image",
  enforce: "post",
  transform: (code, id) => {
    if (!IMAGE_FILE_PATTERN.test(id)) return null;
    const match = /^export default (.+);?$/m.exec(code);
    return match
      ? code.replace(
          match[0],
          `export default { src: ${match[1]}, width: 1, height: 1, blurDataURL: ${match[1]} };`,
        )
      : null;
  },
});
