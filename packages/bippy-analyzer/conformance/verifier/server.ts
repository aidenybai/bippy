import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import MagicString from "magic-string";
import { createServer, loadEnv, parseAst } from "vite";
import type { DepOptimizationConfig, Plugin, Rollup } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { PROVIDERS_PATH, SETUP_PATH, WRAPPER_PATH } from "./types.js";
import type { ProbeMode } from "./types.js";

export interface Probe {
  id: string;
  file: string;
  start: number;
  end: number;
  mode: ProbeMode;
}

/**
 * What a repo needs before its components can mount, from its `verify` directory:
 * `setup.tsx` runs before any component loads and may export default providers to wrap
 * every component in, and `harness.json` adds environment variables and module aliases.
 */
interface HarnessSetup {
  file: string | null;
  env: Record<string, string>;
  alias: Record<string, string>;
}

type HarnessConfig = Partial<Pick<HarnessSetup, "env" | "alias">>;

type OptimizerPlugin = NonNullable<
  NonNullable<DepOptimizationConfig["esbuildOptions"]>["plugins"]
>[number];

/**
 * A running harness. `getDependencyHash` changes whenever Vite pre-bundles dependencies again,
 * after which a page that already loaded them holds a stale copy of React.
 */
export interface Harness {
  url: string;
  exportIndex: Map<string, string[]>;
  getModuleUrl: (file: string) => string;
  getDependencyHash: () => string;
  close: () => Promise<void>;
}

/**
 * A provider the harness mounts every component in when its package is installed. `modules`
 * are what it imports, pre-bundled before any component mounts, and default to the package.
 */
interface ProviderSpec {
  packageName: string;
  modules?: string[];
  imports: string;
  wrap: (children: string) => string;
}

const HARNESS_PATH = "/__bippy_verify";
const ENTRY_PATH = "/__bippy_verify_entry.ts";

const SETUP_FILE = "setup.tsx";
const HARNESS_CONFIG_FILE = "harness.json";
/**
 * Mounts inside a data router where the package has one, since hooks like `useNavigation`
 * throw outside it, and inside a `MemoryRouter` before React Router 6.4.
 */
const createRouterSpec = (packageName: string): ProviderSpec => ({
  packageName,
  imports: [
    `import * as ReactRouter from ${JSON.stringify(packageName)};`,
    "const DataRouter = ({ children }) => {",
    '  const [router] = useState(() => ReactRouter.createMemoryRouter([{ path: "*", element: children }]));',
    "  return createElement(ReactRouter.RouterProvider, { router });",
    "};",
  ].join("\n"),
  wrap: (children) =>
    `createElement(ReactRouter.createMemoryRouter ? DataRouter : ReactRouter.MemoryRouter, null, ${children})`,
});

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    packageName: "@tanstack/react-query",
    imports: 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    wrap: (children) =>
      `createElement(QueryClientProvider, { client: useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))[0] }, ${children})`,
  },
  createRouterSpec("react-router"),
  createRouterSpec("react-router-dom"),
  {
    packageName: "react-hook-form",
    imports: 'import { FormProvider, useForm } from "react-hook-form";',
    wrap: (children) => `createElement(FormProvider, useForm(), ${children})`,
  },
];
const NEXT_FONT_ID = "\0bippy-verify-next-font";
const NEXT_FONT_MODULES = new Set(["next/font/google", "next/font/local"]);
const NEXT_NAVIGATION_STUB = join(import.meta.dirname, "stubs/next-navigation.ts");
const NEXT_ROUTER_STUB = join(import.meta.dirname, "stubs/next-router.ts");
const NEXT_STUBS = new Map([
  ["next/navigation", NEXT_NAVIGATION_STUB],
  ["next/document", join(import.meta.dirname, "stubs/next-document.ts")],
  ["next/router", NEXT_ROUTER_STUB],
]);
const NEXT_CONTEXT_MODULES = ["app-router-context", "hooks-client-context", "router-context"];
const ENV_PLACEHOLDER = "https://example.com";
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const ENV_REFERENCE_PATTERN = /\b(process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g;
const NEXT_FONT_IMPORT_PATTERN =
  /import\s+(?:\w+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']next\/font\/(?:google|local)["']/g;
const EXPORT_DECLARATION_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Z]\w*)/g;
const EXPORT_LIST_PATTERN = /export\s*\{([^}]*)\}/g;
const ENTRY_SOURCE = join(import.meta.dirname, "browser-entry.ts");
const BIPPY_SOURCE = join(import.meta.dirname, "../../../bippy/src/index.ts");

const SERVER_DIRECTIVE = "use server";
const MISSING_MODULE_NAMESPACE = "bippy-missing-module";
const RELATIVE_SPECIFIER_PATTERN = /^\.{0,2}\//;

const isRequirable = (specifier: string, importer: string): boolean => {
  try {
    createRequire(importer).resolve(specifier);
    return true;
  } catch {
    return false;
  }
};

/**
 * Dependencies pre-bundle in one batch, and one `require` of a module that isn't installed,
 * like Next's server requiring `critters` or an ungenerated `.prisma/client`, fails the whole
 * batch and so every component. Such a `require` throws in Node too, so it becomes an empty
 * module instead.
 */
const createMissingRequirePlugin = (): OptimizerPlugin => ({
  name: MISSING_MODULE_NAMESPACE,
  setup: (build) => {
    build.onResolve({ filter: /.*/ }, ({ path, importer, kind }) =>
      kind === "require-call" &&
      importer &&
      !RELATIVE_SPECIFIER_PATTERN.test(path) &&
      !isRequirable(path, importer)
        ? { path, namespace: MISSING_MODULE_NAMESPACE }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: MISSING_MODULE_NAMESPACE }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }));
  },
});

const getExportNames = (program: Rollup.ProgramNode): string[] =>
  program.body.flatMap((statement) => {
    if (statement.type === "ExportDefaultDeclaration") return ["default"];
    if (statement.type !== "ExportNamedDeclaration") return [];
    const { declaration, specifiers } = statement;
    const declared =
      declaration?.type === "VariableDeclaration"
        ? declaration.declarations.flatMap((declarator) =>
            declarator.id.type === "Identifier" ? [declarator.id.name] : [],
          )
        : declaration && "id" in declaration && declaration.id
          ? [declaration.id.name]
          : [];
    return [
      ...declared,
      ...specifiers.map((specifier) =>
        specifier.exported.type === "Identifier"
          ? specifier.exported.name
          : String(specifier.exported.value),
      ),
    ];
  });

/**
 * A `"use server"` module runs on the server, and a client bundle only gets functions that
 * call it, so its exports become async functions that do nothing instead of database code
 * a browser can't load.
 */
const createServerActionPlugin = (): Plugin => ({
  name: "bippy-verify-server-actions",
  transform: (code) => {
    if (!code.includes(SERVER_DIRECTIVE)) return null;
    const program = parseAst(code);
    const [firstStatement] = program.body;
    if (
      firstStatement?.type !== "ExpressionStatement" ||
      !("directive" in firstStatement) ||
      firstStatement.directive !== SERVER_DIRECTIVE
    )
      return null;
    return getExportNames(program)
      .map((name) =>
        name === "default"
          ? "export default async () => undefined;"
          : `export const ${name} = async () => undefined;`,
      )
      .join("\n");
  },
});

const createProbePlugin = (probes: Probe[]): Plugin => {
  const probesByFile = Map.groupBy(probes, (probe) => probe.file);
  return {
    name: "bippy-verify-probes",
    enforce: "pre",
    transform: (code, id) => {
      const fileProbes = probesByFile.get(id.split("?")[0] ?? id);
      if (!fileProbes) return null;
      const source = new MagicString(code);
      const innermostFirst = [...fileProbes].sort(
        (left, right) => left.end - left.start - (right.end - right.start),
      );
      for (const probe of innermostFirst) {
        source.prependRight(
          probe.start,
          `__bippyProbe(${JSON.stringify(probe.id)}, ${JSON.stringify(probe.mode)}, (`,
        );
        source.appendLeft(probe.end, "))");
      }
      return { code: source.toString(), map: source.generateMap({ hires: true }) };
    },
  };
};

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Whether the app declares a package. Resolving it isn't enough: Node looks in every
 * enclosing `node_modules`, where a monorepo installs packages its other apps use.
 */
const isDeclared = (appDirectory: string, packageName: string): boolean => {
  const manifestPath = join(appDirectory, "package.json");
  if (!existsSync(manifestPath)) return true;
  const manifest: PackageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some(
    (dependencies) => dependencies !== undefined && packageName in dependencies,
  );
};

const resolvePackageDirectory = (appDirectory: string, packageName: string): string | null => {
  if (!isDeclared(appDirectory, packageName)) return null;
  try {
    return dirname(
      createRequire(join(appDirectory, "package.json")).resolve(`${packageName}/package.json`),
    );
  } catch {
    return null;
  }
};

const isInstalled = (appDirectory: string, packageName: string): boolean =>
  resolvePackageDirectory(appDirectory, packageName) !== null;

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_FILE_PATTERN.test(entry.name) ? [path] : [];
  });

interface SourceReferences {
  processEnv: Set<string>;
  importMetaEnv: Set<string>;
  nextFonts: Set<string>;
  exports: Map<string, string[]>;
}

/**
 * What the harness needs to know about an app's source: the environment variables and
 * `next/font` names it reads at import time, which the harness supplies so modules load, and
 * where each capitalized name is exported, to find a provider a component asks for.
 */
const collectSourceReferences = (appDirectory: string): SourceReferences => {
  const references: SourceReferences = {
    processEnv: new Set(),
    importMetaEnv: new Set(),
    nextFonts: new Set(),
    exports: new Map(),
  };
  const addExport = (name: string, file: string): void => {
    references.exports.set(name, [...(references.exports.get(name) ?? []), file]);
  };
  for (const file of listSourceFiles(appDirectory)) {
    const text = readFileSync(file, "utf8");
    for (const [, name = ""] of text.matchAll(EXPORT_DECLARATION_PATTERN)) addExport(name, file);
    for (const [, names = ""] of text.matchAll(EXPORT_LIST_PATTERN))
      for (const specifier of names.split(",")) {
        const exported = specifier
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (exported && /^[A-Z]/.test(exported)) addExport(exported, file);
      }
    for (const [, source = "", name = ""] of text.matchAll(ENV_REFERENCE_PATTERN))
      (source === "process.env" ? references.processEnv : references.importMetaEnv).add(name);
    for (const [, names = ""] of text.matchAll(NEXT_FONT_IMPORT_PATTERN))
      for (const name of names.split(",")) {
        const localName = name.split(/\s+as\s+/)[0]?.trim();
        if (localName) references.nextFonts.add(localName);
      }
  }
  return references;
};

const createNextFontSource = (fontNames: Set<string>): string =>
  [
    'const font = () => ({ className: "", style: { fontFamily: "sans-serif" }, variable: "" });',
    "export default font;",
    ...[...fontNames].map((name) => `export const ${name} = font;`),
  ].join("\n");

/**
 * The module that defines one of Next's router contexts, named with `.shared-runtime` since
 * Next 13.5.
 */
const resolveNextContextModule = (nextDirectory: string, name: string): string | null => {
  const fileName = [`${name}.shared-runtime`, name].find((candidate) =>
    existsSync(join(nextDirectory, "dist/shared/lib", `${candidate}.js`)),
  );
  return fileName ? `next/dist/shared/lib/${fileName}` : null;
};

/**
 * Provides Next's own router contexts with the stub routers, so `next/navigation` and
 * `next/router` work when a package imports them, like `@clerk/nextjs` does, where the stubs
 * for the app's own imports don't reach.
 */
const createNextContextSpec = (appDirectory: string): ProviderSpec | null => {
  const nextDirectory = resolvePackageDirectory(appDirectory, "next");
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

const getInstalledProviders = (appDirectory: string): ProviderSpec[] => {
  const installed = PROVIDER_SPECS.filter((spec) => isInstalled(appDirectory, spec.packageName));
  const nextContextSpec = createNextContextSpec(appDirectory);
  const providers = nextContextSpec ? [nextContextSpec, ...installed] : installed;
  return providers.some((spec) => spec.packageName === "react-router")
    ? providers.filter((spec) => spec.packageName !== "react-router-dom")
    : providers;
};

export const readHarnessSetup = (directory: string | null): HarnessSetup => {
  if (!directory) return { file: null, env: {}, alias: {} };
  const setupFile = join(directory, SETUP_FILE);
  const configFile = join(directory, HARNESS_CONFIG_FILE);
  const config: HarnessConfig = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8"))
    : {};
  return {
    file: existsSync(setupFile) ? setupFile : null,
    env: config.env ?? {},
    alias: Object.fromEntries(
      Object.entries(config.alias ?? {}).map(([source, target]) => [
        source,
        target.startsWith(".") ? resolve(directory, target) : target,
      ]),
    ),
  };
};

const createProvidersSource = (providers: ProviderSpec[], setup: HarnessSetup): string => {
  const wrapped = providers.reduceRight(
    (children, provider) => provider.wrap(children),
    setup.file ? "createElement(SetupProviders, null, children)" : "children",
  );
  return [
    'import { createElement, useState } from "react";',
    ...providers.map((provider) => provider.imports),
    ...(setup.file
      ? [
          `import * as setup from ${JSON.stringify(SETUP_PATH)};`,
          "const SetupProviders = setup.default ?? (({ children }) => children);",
        ]
      : []),
    `export default function Providers({ children }) { return ${wrapped}; }`,
  ].join("\n");
};

/**
 * Serves the harness page, its entry, the providers every component mounts in, and the
 * repo's setup. The setup lives outside the app, so its imports resolve as if from a file
 * of the app, where path aliases such as `@/` apply.
 */
const createHarnessPlugin = (
  appDirectory: string,
  providers: ProviderSpec[],
  setup: HarnessSetup,
  appImporter: string,
  references: SourceReferences,
): Plugin => {
  const isNextApp = isInstalled(appDirectory, "next");
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
    async resolveId(source, importer) {
      if (isNextApp && NEXT_FONT_MODULES.has(source)) return NEXT_FONT_ID;
      if (isNextApp && NEXT_STUBS.has(source)) return NEXT_STUBS.get(source);
      if (source === ENTRY_PATH || source === entryId) return entryId;
      if (importer === entryId && source.startsWith("./"))
        return join(import.meta.dirname, source.replace(/\.js$/, ".ts"));
      if (source === PROVIDERS_PATH || source === providersId) return providersId;
      if (source === SETUP_PATH || source === setupId) return setupId;
      if (source.startsWith(`${WRAPPER_PATH}?`))
        return `${wrapperId}${source.slice(WRAPPER_PATH.length)}`;
      if (importer?.startsWith(`${wrapperId}?`))
        return this.resolve(source, getWrapperQuery(importer).get("importer") ?? appImporter, {
          skipSelf: true,
        });
      if (importer === setupId && !source.startsWith("."))
        return this.resolve(source, appImporter, { skipSelf: true });
      if (importer === setupId && setup.file) return resolve(setup.file, "..", source);
      return null;
    },
    load: (id) => {
      if (id === NEXT_FONT_ID) return createNextFontSource(references.nextFonts);
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

export const startHarness = async (
  appDirectory: string,
  probes: Probe[],
  componentFiles: string[],
  setup: HarnessSetup,
): Promise<Harness> => {
  const providers = getInstalledProviders(appDirectory);
  const appImporter = componentFiles[0] ?? join(appDirectory, "index.ts");
  const references = collectSourceReferences(appDirectory);
  const loadedEnv = loadEnv("development", appDirectory, "");
  const getPlaceholders = (names: Set<string>): Record<string, string> =>
    Object.fromEntries(
      [...names].filter((name) => !(name in loadedEnv)).map((name) => [name, ENV_PLACEHOLDER]),
    );
  const processEnv = {
    ...getPlaceholders(references.processEnv),
    ...loadedEnv,
    ...setup.env,
    NODE_ENV: "development",
  };
  const importMetaEnv = { ...getPlaceholders(references.importMetaEnv), ...setup.env };
  const server = await createServer({
    configFile: false,
    root: appDirectory,
    logLevel: "error",
    appType: "custom",
    plugins: [
      createHarnessPlugin(appDirectory, providers, setup, appImporter, references),
      createProbePlugin(probes),
      createServerActionPlugin(),
      tsconfigPaths({ root: appDirectory }),
    ],
    resolve: {
      alias: [
        { find: /^bippy$/, replacement: BIPPY_SOURCE },
        ...Object.entries(setup.alias).map(([source, target]) => ({
          find: new RegExp(`^${RegExp.escape(source)}$`),
          replacement: target,
        })),
      ],
      dedupe: ["react", "react-dom"],
    },
    esbuild: { jsx: "automatic", jsxDev: true },
    define: {
      "process.env": JSON.stringify(processEnv),
      ...Object.fromEntries(
        Object.entries(importMetaEnv).map(([name, value]) => [
          `import.meta.env.${name}`,
          JSON.stringify(value),
        ]),
      ),
    },
    optimizeDeps: {
      entries: componentFiles.map((file) => relative(appDirectory, file)),
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "react/jsx-runtime",
        ...providers.flatMap((provider) => provider.modules ?? [provider.packageName]),
      ],
      esbuildOptions: {
        plugins: [createMissingRequirePlugin()],
        loader: { ".node": "empty" },
      },
    },
    server: { port: 0, strictPort: false, hmr: false, fs: { strict: false } },
  });
  await server.listen();
  await Promise.all(
    [
      ENTRY_PATH,
      PROVIDERS_PATH,
      ...componentFiles.map((file) => `/${relative(appDirectory, file)}`),
    ].map((url) => server.warmupRequest(url)),
  );
  await server.waitForRequestsIdle();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Harness server has no port");
  return {
    url: `http://localhost:${address.port}${HARNESS_PATH}`,
    exportIndex: references.exports,
    getModuleUrl: (file) => `/${relative(appDirectory, file)}`,
    getDependencyHash: () => server.environments.client.depsOptimizer?.metadata.browserHash ?? "",
    close: () => server.close(),
  };
};
