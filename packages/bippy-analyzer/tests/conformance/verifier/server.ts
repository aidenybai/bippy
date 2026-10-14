import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createServer, loadEnv } from "vite";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { createAssetPlugin } from "./harness/assets";
import {
  createNextImagePlugin,
  getNextImageOptions,
  getNextPolyfillAliases,
  getPolyfilledModules,
} from "./harness/next";
import { resolvePackageDirectory } from "./harness/packages";
import { createProvidersSource, getInstalledProviders } from "./harness/providers";
import type { ProviderSpec } from "./harness/providers";
import type { HarnessSetup } from "./harness/setup";
import { collectSourceReferences, indexSource } from "./harness/source-references";
import type { SourceReferences } from "./harness/source-references";
import {
  createMissingModulePlugin,
  createMissingRequirePlugin,
  createNodeBuiltinPlugin,
  createStandInPlugin,
} from "./harness/stand-ins";
import { createStubPlugin } from "./harness/stubs";
import {
  createCommonJsPlugin,
  createProbePlugin,
  createRequirePlugin,
  createServerActionPlugin,
} from "./harness/transforms";
import { PROVIDERS_PATH, SETUP_PATH, WRAPPER_PATH } from "./types";
import type { Probe, SourceIndex } from "./types";

// HACK: `getDependencyHash` changes when Vite re-bundles dependencies, leaving loaded pages with a
// stale React.
export interface Harness {
  url: string;
  sourceIndex: SourceIndex;
  getModuleUrl: (file: string) => string;
  getDependencyHash: () => string;
  close: () => Promise<void>;
}

const HARNESS_PATH = "/__bippy_verify";
const ENTRY_PATH = "/__bippy_verify_entry.ts";
const ENV_PLACEHOLDER = "https://example.com";
const PREBUNDLED_REACT_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
];
const ENTRY_SOURCE = join(import.meta.dirname, "browser-entry.ts");
const BIPPY_SOURCE = join(import.meta.dirname, "../../../../bippy/src/index.ts");

const createHarnessPlugin = (
  appDirectory: string,
  providers: ProviderSpec[],
  setup: HarnessSetup,
  appImporter: string,
): Plugin => {
  const entryId = join(appDirectory, ENTRY_PATH);
  const providersId = join(appDirectory, PROVIDERS_PATH);
  const setupId = join(appDirectory, SETUP_PATH);
  const wrapperId = join(appDirectory, WRAPPER_PATH);
  const getWrapperQuery = (id: string): URLSearchParams =>
    new URLSearchParams(id.slice(id.indexOf("?") + 1));
  const providersSource = createProvidersSource(providers, setup);
  return {
    name: "bippy-verify-harness",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === ENTRY_PATH || source === entryId) return entryId;
      if (importer === entryId && source.startsWith("./"))
        return join(import.meta.dirname, `${source.replace(/\.js$/, "")}.ts`);
      if (source === PROVIDERS_PATH || source === providersId) return providersId;
      if (source === SETUP_PATH || source === setupId) return setupId;
      if (source.startsWith(`${WRAPPER_PATH}?`))
        return `${wrapperId}${source.slice(WRAPPER_PATH.length)}`;
      if (importer?.startsWith(`${wrapperId}?`))
        return this.resolve(source, getWrapperQuery(importer).get("importer") ?? appImporter, {
          skipSelf: true,
        });
      // HACK: the setup lives outside the app, so its imports resolve as if from an app file, where
      // path aliases apply.
      if (importer === setupId && !source.startsWith("."))
        return this.resolve(source, appImporter, { skipSelf: true });
      if (importer === setupId && setup.file)
        return this.resolve(source, setup.file, { skipSelf: true });
      return null;
    },
    load: (id) => {
      if (id === entryId) return readFileSync(ENTRY_SOURCE, "utf8");
      if (id === providersId) return providersSource;
      if (id === setupId) return setup.file ? readFileSync(setup.file, "utf8") : "";
      if (id.startsWith(`${wrapperId}?`))
        return `export * from ${JSON.stringify(getWrapperQuery(id).get("specifier"))};`;
      return null;
    },
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        if (request.url !== HARNESS_PATH) return next();
        response.setHeader("content-type", "text/html");
        response.end(
          `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="${ENTRY_PATH}"></script></body></html>`,
        );
      });
    },
  };
};

interface HarnessContext {
  appDirectory: string;
  nextDirectory: string | null;
  appImporter: string;
  componentFiles: string[];
  probes: Probe[];
  references: SourceReferences;
  providers: ProviderSpec[];
  setup: HarnessSetup;
}

const getEnvDefines = (context: HarnessContext): Record<string, string> => {
  const loadedEnv = loadEnv("development", context.appDirectory, "");
  const getPlaceholders = (names: Set<string>): Record<string, string> =>
    Object.fromEntries(
      [...names].filter((name) => !(name in loadedEnv)).map((name) => [name, ENV_PLACEHOLDER]),
    );
  const processEnv = {
    ...getPlaceholders(context.references.processEnv),
    ...loadedEnv,
    ...context.setup.env,
    NODE_ENV: "development",
    ...getNextImageOptions(context.nextDirectory),
  };
  const importMetaEnv = {
    ...getPlaceholders(context.references.importMetaEnv),
    ...context.setup.env,
  };
  return {
    "process.env": JSON.stringify(processEnv),
    ...Object.fromEntries(
      Object.entries(importMetaEnv).map(([name, value]) => [
        `import.meta.env.${name}`,
        JSON.stringify(value),
      ]),
    ),
  };
};

const createHarnessConfig = (context: HarnessContext): InlineConfig => {
  const { appDirectory, nextDirectory, references, providers, setup } = context;
  const polyfilledModules = getPolyfilledModules(nextDirectory);
  return {
    configFile: false,
    root: appDirectory,
    logLevel: "error",
    appType: "custom",
    plugins: [
      createStubPlugin(nextDirectory, context.appImporter, references.nextFonts),
      createStandInPlugin(polyfilledModules, references.packageImports),
      createAssetPlugin(),
      createHarnessPlugin(appDirectory, providers, setup, context.appImporter),
      createMissingModulePlugin(),
      createProbePlugin(context.probes),
      ...(nextDirectory ? [createNextImagePlugin()] : []),
      createServerActionPlugin(),
      createCommonJsPlugin(),
      createRequirePlugin(),
      tsconfigPaths({ root: appDirectory }),
    ],
    resolve: {
      alias: [
        { find: /^bippy$/, replacement: BIPPY_SOURCE },
        ...getNextPolyfillAliases(nextDirectory),
        ...Object.entries(setup.alias).map(([source, target]) => ({
          find: new RegExp(`^${RegExp.escape(source)}$`),
          replacement: target,
        })),
      ],
      dedupe: ["react", "react-dom"],
    },
    // HACK: an empty PostCSS config keeps an app's Tailwind or Sass setup from failing imports.
    css: { postcss: {} },
    esbuild: { jsx: "automatic", jsxDev: true },
    define: getEnvDefines(context),
    optimizeDeps: {
      entries: context.componentFiles.map((file) => relative(appDirectory, file)),
      include: [
        ...PREBUNDLED_REACT_MODULES,
        ...providers.flatMap((provider) => provider.modules ?? [provider.packageName]),
      ],
      esbuildOptions: {
        plugins: [createMissingRequirePlugin(), createNodeBuiltinPlugin(polyfilledModules)],
        loader: { ".node": "empty" },
        // HACK: Webpack, which Next bundles client code with, makes `__dirname` the root.
        ...(nextDirectory ? { define: { __dirname: '"/"' } } : {}),
      },
    },
    server: { port: 0, strictPort: false, hmr: false, fs: { strict: false } },
  };
};

const warmUpHarness = async (server: ViteDevServer, context: HarnessContext): Promise<void> => {
  const componentUrls = context.componentFiles.map(
    (file) => `/${relative(context.appDirectory, file)}`,
  );
  await Promise.all(
    [ENTRY_PATH, PROVIDERS_PATH, ...componentUrls].map((url) => server.warmupRequest(url)),
  );
  await server.waitForRequestsIdle();
};

const getServerPort = (server: ViteDevServer): number => {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Harness server has no port");
  return address.port;
};

export const startHarness = async (
  appDirectory: string,
  probes: Probe[],
  componentFiles: string[],
  setup: HarnessSetup,
): Promise<Harness> => {
  const nextDirectory = resolvePackageDirectory(appDirectory, "next");
  const references = collectSourceReferences(appDirectory);
  const context: HarnessContext = {
    appDirectory,
    nextDirectory,
    appImporter: componentFiles[0] ?? join(appDirectory, "index.ts"),
    componentFiles,
    probes,
    references,
    providers: getInstalledProviders(appDirectory, nextDirectory, references.reduxStore),
    setup,
  };
  const server = await createServer(createHarnessConfig(context));
  await server.listen();
  await warmUpHarness(server, context);
  const sourceIndex = await indexSource(references, server);
  return {
    url: `http://localhost:${getServerPort(server)}${HARNESS_PATH}`,
    sourceIndex,
    getModuleUrl: (file) => `/${relative(appDirectory, file)}`,
    getDependencyHash: () => server.environments.client.depsOptimizer?.metadata.browserHash ?? "",
    close: () => server.close(),
  };
};
