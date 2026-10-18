import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { AnalyzerSource } from "./analyzer-json";
import type { FileInfo, ViewComponent } from "../src/model";

const serverDirectory = fileURLToPath(new URL(".", import.meta.url));

interface ViewModelModule {
  getFileSource: (file: string) => AnalyzerSource;
  getFileComponents: (file: string) => FileInfo;
  getViewModel: (
    source: AnalyzerSource,
    component: string,
    file: string | null,
  ) => ViewComponent | null;
}

const sendJson = (response: ServerResponse, value: unknown): void => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
};

const sendError = (response: ServerResponse, status: number, error: unknown): void => {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain");
  response.end(error instanceof Error ? (error.stack ?? error.message) : String(error));
};

const getSource = (url: URL, module: ViewModelModule): AnalyzerSource | null => {
  const json = url.searchParams.get("json");
  if (json) return { kind: "json", path: resolve(json) };
  const file = url.searchParams.get("file");
  return file ? module.getFileSource(resolve(file)) : null;
};

const handle = async (
  server: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const module = (await server.ssrLoadModule(
    resolve(serverDirectory, "view-model.ts"),
  )) as ViewModelModule;
  const file = url.searchParams.get("file");
  if (url.pathname === "/api/file") {
    if (!file) return sendError(response, 400, "Missing file");
    return sendJson(response, module.getFileComponents(resolve(file)));
  }
  if (url.pathname === "/api/analysis") {
    const source = getSource(url, module);
    const component = url.searchParams.get("component");
    if (!source || !component) return sendError(response, 400, "Missing file or component");
    return sendJson(response, module.getViewModel(source, component, file ? resolve(file) : null));
  }
  sendError(response, 404, `No route ${url.pathname}`);
};

export const viewerPlugin = (): Plugin => ({
  name: "bippy-analyzer-viewer",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/api/")) return next();
      handle(server, request, response).catch((error: unknown) => sendError(response, 500, error));
    });
  },
});
