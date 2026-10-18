import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_TSCONFIG = resolve(
  packageDirectory,
  "../../bippy-analyzer/.conformance/prompts-chat/tsconfig.json",
);
const DEFAULT_COMPONENT = "TextToVideoDemo";
const DEFAULT_FILE = "media-demos";

interface AnalysisModule {
  getViewModel: (tsconfig: string, component: string, file: string | null) => unknown;
}

export const analysisPlugin = (): Plugin => ({
  name: "analyzer-viz-analysis",
  configureServer(server) {
    server.middlewares.use("/api/analysis", async (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const tsconfig = url.searchParams.get("tsconfig") ?? DEFAULT_TSCONFIG;
      const component = url.searchParams.get("component") ?? DEFAULT_COMPONENT;
      const file = url.searchParams.get("file") ?? DEFAULT_FILE;
      try {
        const module = (await server.ssrLoadModule(
          resolve(packageDirectory, "analysis.ts"),
        )) as AnalysisModule;
        const viewModel = module.getViewModel(resolve(tsconfig), component, file || null);
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
