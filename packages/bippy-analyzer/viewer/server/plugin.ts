import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import type { AnalyzerSource } from "./analyzer-json";

const serverDirectory = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_TSCONFIG = resolve(
  serverDirectory,
  "../../tests/fixtures/symbolic-tree/tsconfig.json",
);
const DEFAULT_COMPONENT = "Dashboard";
const DEFAULT_FILE = "dashboard";

interface ViewModelModule {
  getViewModel: (source: AnalyzerSource, component: string) => unknown;
}

const getSource = (url: URL): AnalyzerSource => {
  const json = url.searchParams.get("json");
  if (json) return { kind: "json", path: resolve(json) };
  const tsconfig = url.searchParams.get("tsconfig") ?? DEFAULT_TSCONFIG;
  const file = url.searchParams.get("file") ?? DEFAULT_FILE;
  return { kind: "project", tsconfig: resolve(tsconfig), fileFilter: file || null };
};

export const viewerPlugin = (): Plugin => ({
  name: "bippy-analyzer-viewer",
  configureServer(server) {
    server.middlewares.use("/api/analysis", async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const component = url.searchParams.get("component") ?? DEFAULT_COMPONENT;
      try {
        const module = await server.ssrLoadModule(resolve(serverDirectory, "view-model.ts"));
        const { getViewModel } = module as ViewModelModule;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(getViewModel(getSource(url), component)));
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain");
        response.end(error instanceof Error ? (error.stack ?? error.message) : String(error));
      }
    });
  },
});
