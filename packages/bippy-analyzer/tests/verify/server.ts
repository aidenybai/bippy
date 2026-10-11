import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import MagicString from "magic-string";
import { createServer, loadEnv } from "vite";
import type { Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
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
export interface HarnessSetup {
  file: string | null;
  env: Record<string, string>;
  alias: Record<string, string>;
}

interface HarnessConfig {
  env?: Record<string, string>;
  alias?: Record<string, string>;
}

interface Harness {
  url: string;
  getModuleUrl: (file: string) => string;
  close: () => Promise<void>;
}

interface ProviderSpec {
  packageName: string;
  imports: string;
  wrap: (children: string) => string;
}

const HARNESS_PATH = "/__bippy_verify";
const ENTRY_PATH = "/__bippy_verify_entry.ts";
const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
const SETUP_PATH = "/__bippy_verify_setup.tsx";
const WRAPPER_PATH = "/__bippy_verify_wrapper.ts";
const SETUP_FILE = "setup.tsx";
const HARNESS_CONFIG_FILE = "harness.json";
const PROVIDER_SPECS: ProviderSpec[] = [
  {
    packageName: "@tanstack/react-query",
    imports: 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    wrap: (children) =>
      `createElement(QueryClientProvider, { client: useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))[0] }, ${children})`,
  },
  {
    packageName: "react-router",
    imports: 'import { MemoryRouter } from "react-router";',
    wrap: (children) => `createElement(MemoryRouter, null, ${children})`,
  },
  {
    packageName: "react-router-dom",
    imports: 'import { MemoryRouter } from "react-router-dom";',
    wrap: (children) => `createElement(MemoryRouter, null, ${children})`,
  },
  {
    packageName: "react-hook-form",
    imports: 'import { FormProvider, useForm } from "react-hook-form";',
    wrap: (children) => `createElement(FormProvider, useForm(), ${children})`,
  },
];
const NEXT_FONT_ID = "\0bippy-verify-next-font";
const NEXT_FONT_MODULES = new Set(["next/font/google", "next/font/local"]);
const NEXT_NAVIGATION_STUB = join(import.meta.dirname, "stubs/next-navigation.ts");
const ENV_PLACEHOLDER = "https://example.com";
const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const ENV_REFERENCE_PATTERN = /\b(process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]*)/g;
const NEXT_FONT_IMPORT_PATTERN =
  /import\s+(?:\w+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']next\/font\/(?:google|local)["']/g;
const ENTRY_SOURCE = join(import.meta.dirname, "browser-entry.ts");
const BIPPY_SOURCE = join(import.meta.dirname, "../../../bippy/src/index.ts");

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

const isInstalled = (appDirectory: string, packageName: string): boolean => {
  try {
    createRequire(join(appDirectory, "package.json")).resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
};

export const listSourceFiles = (directory: string): string[] =>
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
}

/**
 * The environment variables and `next/font` names an app's source refers to, so the harness
 * can supply them: apps often validate their environment, or call a font loader, at import
 * time, and fail to load before any component renders.
 */
const collectSourceReferences = (appDirectory: string): SourceReferences => {
  const references: SourceReferences = {
    processEnv: new Set(),
    importMetaEnv: new Set(),
    nextFonts: new Set(),
  };
  for (const file of listSourceFiles(appDirectory)) {
    const text = readFileSync(file, "utf8");
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

const getInstalledProviders = (appDirectory: string): ProviderSpec[] => {
  const installed = PROVIDER_SPECS.filter((spec) => isInstalled(appDirectory, spec.packageName));
  return installed.some((spec) => spec.packageName === "react-router")
    ? installed.filter((spec) => spec.packageName !== "react-router-dom")
    : installed;
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
      if (isNextApp && source === "next/navigation") return NEXT_NAVIGATION_STUB;
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
        ...providers.map((provider) => provider.packageName),
      ],
    },
    server: { port: 0, strictPort: false, hmr: false, fs: { strict: false } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Harness server has no port");
  return {
    url: `http://localhost:${address.port}${HARNESS_PATH}`,
    getModuleUrl: (file) => `/${relative(appDirectory, file)}`,
    close: () => server.close(),
  };
};
