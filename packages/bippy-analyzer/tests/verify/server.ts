import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import MagicString from "magic-string";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import type { ProbeMode } from "./types.js";

export interface Probe {
  id: string;
  file: string;
  start: number;
  end: number;
  mode: ProbeMode;
}

export interface Harness {
  url: string;
  getModuleUrl: (file: string) => string;
  close: () => Promise<void>;
}

interface ProviderSpec {
  packageName: string;
  imports: string;
  wrap: string;
}

const HARNESS_PATH = "/__bippy_verify";
const ENTRY_PATH = "/__bippy_verify_entry.ts";
const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
const PROVIDER_SPECS: ProviderSpec[] = [
  {
    packageName: "@tanstack/react-query",
    imports: 'import { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
    wrap: "createElement(QueryClientProvider, { client: useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))[0] }, children)",
  },
  {
    packageName: "react-router",
    imports: 'import { MemoryRouter } from "react-router";',
    wrap: "createElement(MemoryRouter, null, children)",
  },
  {
    packageName: "react-router-dom",
    imports: 'import { MemoryRouter } from "react-router-dom";',
    wrap: "createElement(MemoryRouter, null, children)",
  },
  {
    packageName: "react-hook-form",
    imports: 'import { FormProvider, useForm } from "react-hook-form";',
    wrap: "createElement(FormProvider, useForm(), children)",
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

const createProvidersSource = (providers: ProviderSpec[]): string => {
  const wrapped = providers.reduceRight(
    (children, provider) => provider.wrap.replaceAll("children", children),
    "children",
  );
  return [
    'import { createElement, useState } from "react";',
    ...providers.map((provider) => provider.imports),
    `export default function Providers({ children }) { return ${wrapped}; }`,
  ].join("\n");
};

const createHarnessPlugin = (appDirectory: string, providers: ProviderSpec[]): Plugin => {
  const entryId = join(appDirectory, ENTRY_PATH);
  const providersId = join(appDirectory, PROVIDERS_PATH);
  const providersSource = createProvidersSource(providers);
  return {
    name: "bippy-verify-harness",
    enforce: "pre",
    resolveId: (source) => {
      if (source === ENTRY_PATH || source === entryId) return entryId;
      if (source === PROVIDERS_PATH || source === providersId) return providersId;
      return null;
    },
    load: (id) => {
      if (id === entryId) return readFileSync(ENTRY_SOURCE, "utf8");
      if (id === providersId) return providersSource;
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
): Promise<Harness> => {
  const providers = getInstalledProviders(appDirectory);
  const server: ViteDevServer = await createServer({
    configFile: false,
    root: appDirectory,
    logLevel: "error",
    appType: "custom",
    plugins: [
      createHarnessPlugin(appDirectory, providers),
      createProbePlugin(probes),
      tsconfigPaths({ root: appDirectory }),
    ],
    resolve: {
      alias: [{ find: /^bippy$/, replacement: BIPPY_SOURCE }],
      dedupe: ["react", "react-dom"],
    },
    esbuild: { jsx: "automatic", jsxDev: true },
    define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) },
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
