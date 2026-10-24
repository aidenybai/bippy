import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createServer, loadEnv } from "vite";
import type { Alias, DepOptimizationOptions, InlineConfig, Plugin, ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { createAssetPlugin, createWorkerImportPlugin } from "./harness/assets";
import { createLocalExportPlugin } from "./harness/local-exports";
import {
  createNextImagePlugin,
  getNextImageOptions,
  getNextPolyfillAliases,
  getPolyfilledModules,
} from "./harness/next";
import { isDependencyDeclared, resolvePackageDirectory } from "./harness/packages";
import { createProvidersSource, getInstalledProviders } from "./harness/providers";
import type { ProviderSpec } from "./harness/providers";
import type { HarnessSetup } from "./harness/setup";
import { collectSourceReferences, indexSource } from "./harness/source-references";
import { createTypeReexportPlugin } from "./harness/type-exports";
import type { SourceReferences } from "./harness/source-references";
import {
  createMissingModulePlugin,
  createMissingDependencyPlugin,
  createNodeBuiltinPlugin,
  createPrebundledStubPlugin,
  createStandInPlugin,
} from "./harness/stand-ins";
import { createStubPlugin } from "./harness/stubs";
import {
  createCommonJsPlugin,
  createImportMetaUrlFilterPlugin,
  createProbePlugin,
  createRequirePlugin,
  createJsxInScriptPlugin,
  createServerActionPlugin,
} from "./harness/transforms";
import { ENTRY_PATH, PROVIDERS_PATH, SETUP_PATH, WRAPPER_PATH } from "./types";
import type { Probe, SourceIndex } from "./types";

export interface Harness {
  url: string;
  sourceIndex: SourceIndex;
  getModuleUrl: (file: string) => string;
  getDependencyHash: () => string;
  close: () => Promise<void>;
}

interface HarnessIds {
  entry: string;
  providers: string;
  setup: string;
  wrapper: string;
}

const HARNESS_PATH = "/__bippy_verify";
const ENV_PLACEHOLDER = "https://example.com";
const LIBRARY_ENV_DEFAULTS = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("clerk.example.com$").toString("base64")}`,
};
const PREBUNDLED_REACT_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
];
const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="${ENTRY_PATH}"></script></body></html>`;
const ENTRY_SOURCE = join(import.meta.dirname, "browser-entry.ts");
const BIPPY_SOURCE = join(import.meta.dirname, "../../../../bippy/src/index.ts");
const BROWSER_DIRECTORY = join(import.meta.dirname, "browser/");

const createHarnessIds = (appDirectory: string): HarnessIds => ({
  entry: join(appDirectory, ENTRY_PATH),
  providers: join(appDirectory, PROVIDERS_PATH),
  setup: join(appDirectory, SETUP_PATH),
  wrapper: join(appDirectory, WRAPPER_PATH),
});

const getWrapperQuery = (id: string): URLSearchParams =>
  new URLSearchParams(id.slice(id.indexOf("?") + 1));

const resolveHarnessModule = (
  source: string,
  importer: string | undefined,
  ids: HarnessIds,
): string | null => {
  if (source === ENTRY_PATH || source === ids.entry) return ids.entry;
  if (source === "bippy" && (importer === ids.entry || importer?.startsWith(BROWSER_DIRECTORY)))
    return BIPPY_SOURCE;
  if (importer === ids.entry && source.startsWith("./"))
    return join(import.meta.dirname, `${source.replace(/\.js$/, "")}.ts`);
  if (source === PROVIDERS_PATH || source === ids.providers) return ids.providers;
  if (source === SETUP_PATH || source === ids.setup) return ids.setup;
  if (source.startsWith(`${WRAPPER_PATH}?`))
    return `${ids.wrapper}${source.slice(WRAPPER_PATH.length)}`;
  return null;
};

const getHarnessImporter = (
  source: string,
  importer: string | undefined,
  ids: HarnessIds,
  setup: HarnessSetup,
  appImporter: string,
): string | null => {
  if (importer?.startsWith(`${ids.wrapper}?`))
    return getWrapperQuery(importer).get("importer") ?? appImporter;
  if (importer === ids.setup && !source.startsWith(".")) return appImporter;
  if (importer === ids.setup && setup.file) return setup.file;
  return null;
};

const loadHarnessModule = (
  id: string,
  ids: HarnessIds,
  providersSource: string,
  setup: HarnessSetup,
): string | null => {
  if (id === ids.entry) return readFileSync(ENTRY_SOURCE, "utf8");
  if (id === ids.providers) return providersSource;
  if (id === ids.setup) return setup.file ? readFileSync(setup.file, "utf8") : "";
  if (id.startsWith(`${ids.wrapper}?`))
    return `export * from ${JSON.stringify(getWrapperQuery(id).get("specifier"))};`;
  return null;
};

const createHarnessPlugin = (
  appDirectory: string,
  providers: ProviderSpec[],
  setup: HarnessSetup,
  appImporter: string,
): Plugin => {
  const ids = createHarnessIds(appDirectory);
  const providersSource = createProvidersSource(providers, setup);
  return {
    name: "bippy-verify-harness",
    enforce: "pre",
    resolveId(source, importer) {
      const harnessModule = resolveHarnessModule(source, importer, ids);
      if (harnessModule) return harnessModule;
      const harnessImporter = getHarnessImporter(source, importer, ids, setup, appImporter);
      return harnessImporter === null
        ? null
        : this.resolve(source, harnessImporter, { skipSelf: true });
    },
    load: (id) => loadHarnessModule(id, ids, providersSource, setup),
    configureServer: (server) => {
      server.middlewares.use((request, response, next) => {
        if (request.url !== HARNESS_PATH) return next();
        response.setHeader("content-type", "text/html");
        response.end(HARNESS_HTML);
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
  localNamesByFile: Map<string, string[]>;
}

const getEnvDefines = (context: HarnessContext): Record<string, string> => {
  const loadedEnv = loadEnv("development", context.appDirectory, "");
  const getPlaceholders = (names: Set<string>): Record<string, string> =>
    Object.fromEntries(
      [...names].filter((name) => !(name in loadedEnv)).map((name) => [name, ENV_PLACEHOLDER]),
    );
  const processEnv = {
    ...getPlaceholders(context.references.processEnv),
    ...LIBRARY_ENV_DEFAULTS,
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

const createHarnessPlugins = (
  context: HarnessContext,
  polyfilledModules: Set<string>,
): Plugin[] => {
  const { appDirectory, nextDirectory, references } = context;
  return [
    createStubPlugin(nextDirectory, context.appImporter, references.nextFonts),
    createStandInPlugin(polyfilledModules, references.packageImports),
    createAssetPlugin(isDependencyDeclared(appDirectory, "@svgr/webpack")),
    ...(isDependencyDeclared(appDirectory, "worker-loader") ? [createWorkerImportPlugin()] : []),
    createHarnessPlugin(appDirectory, context.providers, context.setup, context.appImporter),
    createMissingModulePlugin(),
    createProbePlugin(context.probes),
    ...(nextDirectory ? [createNextImagePlugin()] : []),
    createJsxInScriptPlugin(),
    createServerActionPlugin(),
    createTypeReexportPlugin(),
    createLocalExportPlugin(context.localNamesByFile),
    createCommonJsPlugin(),
    createRequirePlugin(),
    createImportMetaUrlFilterPlugin(),
    tsconfigPaths({ root: appDirectory }),
  ];
};

const getHarnessAliases = (context: HarnessContext): Alias[] => [
  ...getNextPolyfillAliases(context.nextDirectory),
  ...Object.entries(context.setup.alias).map(([source, target]) => ({
    find: new RegExp(`^${RegExp.escape(source)}$`),
    replacement: target,
  })),
];

const createOptimizeDepsOptions = (
  context: HarnessContext,
  polyfilledModules: Set<string>,
): DepOptimizationOptions => ({
  entries: context.componentFiles.map((file) => relative(context.appDirectory, file)),
  include: [
    ...PREBUNDLED_REACT_MODULES,
    ...context.providers.flatMap((provider) => provider.modules ?? [provider.packageName]),
  ],
  esbuildOptions: {
    plugins: [
      createPrebundledStubPlugin(),
      createMissingDependencyPlugin(),
      createNodeBuiltinPlugin(polyfilledModules),
    ],
    loader: { ".node": "empty" },
    ...(context.nextDirectory ? { define: { __dirname: '"/"' } } : {}),
  },
});

const createHarnessConfig = (context: HarnessContext): InlineConfig => {
  const polyfilledModules = getPolyfilledModules(context.nextDirectory);
  return {
    configFile: false,
    root: context.appDirectory,
    logLevel: "error",
    appType: "custom",
    plugins: createHarnessPlugins(context, polyfilledModules),
    resolve: { alias: getHarnessAliases(context), dedupe: ["react", "react-dom"] },
    css: { postcss: {} },
    esbuild: { jsx: "automatic", jsxDev: true },
    define: getEnvDefines(context),
    optimizeDeps: createOptimizeDepsOptions(context, polyfilledModules),
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
  localNamesByFile: Map<string, string[]>,
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
    localNamesByFile,
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
