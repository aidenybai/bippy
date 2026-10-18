import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_TSCONFIG = resolve(
  packageDirectory,
  "../../bippy-analyzer/tests/fixtures/symbolic-tree/tsconfig.json",
);
const DEFAULT_COMPONENT = "Dashboard";
const DEFAULT_FILE = "dashboard";

interface AnalyzerSource {
  kind: "project" | "json";
  tsconfig?: string;
  fileFilter?: string | null;
  path?: string;
}

interface AnalysisModule {
  getViewModel: (source: AnalyzerSource, component: string) => unknown;
}

export const analysisPlugin = (): Plugin => ({
  name: "analyzer-viz-analysis",
  configureServer(server) {
    server.middlewares.use("/api/analysis", async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const json = url.searchParams.get("json");
      const tsconfig = url.searchParams.get("tsconfig") ?? DEFAULT_TSCONFIG;
      const component = url.searchParams.get("component") ?? DEFAULT_COMPONENT;
      const file = url.searchParams.get("file") ?? DEFAULT_FILE;
      const source: AnalyzerSource = json
        ? { kind: "json", path: resolve(json) }
        : { kind: "project", tsconfig: resolve(tsconfig), fileFilter: file || null };
      try {
        const module = (await server.ssrLoadModule(
          resolve(packageDirectory, "analysis.ts"),
        )) as AnalysisModule;
        const viewModel = module.getViewModel(source, component);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(viewModel));
      } catch (error) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain");
        response.end(error instanceof Error ? (error.stack ?? error.message) : String(error));
      }
    });
  },
});
