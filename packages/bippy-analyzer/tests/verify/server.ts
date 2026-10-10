import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import MagicString from "magic-string";
import { createServer } from "vite";
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

const getInstalledProviders = (appDirectory: string): ProviderSpec[] => {
  const appRequire = createRequire(join(appDirectory, "package.json"));
  const isInstalled = (packageName: string): boolean => {
    try {
      appRequire.resolve(`${packageName}/package.json`);
      return true;
    } catch {
      return false;
    }
  };
  const installed = PROVIDER_SPECS.filter((spec) => isInstalled(spec.packageName));
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
): Plugin => {
  const entryId = join(appDirectory, ENTRY_PATH);
  const providersId = join(appDirectory, PROVIDERS_PATH);
  const setupId = join(appDirectory, SETUP_PATH);
  const providersSource = createProvidersSource(providers, setup);
  return {
    name: "bippy-verify-harness",
    enforce: "pre",
    async resolveId(source, importer) {
      if (source === ENTRY_PATH || source === entryId) return entryId;
      if (importer === entryId && source.startsWith("./"))
        return join(import.meta.dirname, source.replace(/\.js$/, ".ts"));
      if (source === PROVIDERS_PATH || source === providersId) return providersId;
      if (source === SETUP_PATH || source === setupId) return setupId;
      if (importer === setupId && !source.startsWith("."))
        return this.resolve(source, appImporter, { skipSelf: true });
      if (importer === setupId && setup.file) return resolve(setup.file, "..", source);
      return null;
    },
    load: (id) => {
      if (id === entryId) return readFileSync(ENTRY_SOURCE, "utf8");
      if (id === providersId) return providersSource;
      if (id === setupId) return setup.file ? readFileSync(setup.file, "utf8") : "";
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
  const server = await createServer({
    configFile: false,
    root: appDirectory,
    logLevel: "error",
    appType: "custom",
    plugins: [
      createHarnessPlugin(appDirectory, providers, setup, appImporter),
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
      "process.env": JSON.stringify({ NODE_ENV: "development", ...setup.env }),
      ...Object.fromEntries(
        Object.entries(setup.env).map(([name, value]) => [
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
