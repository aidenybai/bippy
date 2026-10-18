import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { ViewFile } from "../src/model";

const serverDirectory = fileURLToPath(new URL(".", import.meta.url));

interface ViewModelModule {
  getViewFile: (file: string) => ViewFile;
  getAnalyzerJson: (file: string) => string;
}

const isViewModelModule = (module: object): module is ViewModelModule =>
  "getViewFile" in module &&
  typeof module.getViewFile === "function" &&
  "getAnalyzerJson" in module &&
  typeof module.getAnalyzerJson === "function";

const loadViewModel = async (server: ViteDevServer): Promise<ViewModelModule> => {
  const module = await server.ssrLoadModule(resolve(serverDirectory, "view-model.ts"));
  if (!isViewModelModule(module)) throw new Error("view-model.ts does not export getViewFile");
  return module;
};

const sendJson = (response: ServerResponse, value: unknown): void => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
};

const sendText = (response: ServerResponse, text: string): void => {
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(text);
};

const sendError = (response: ServerResponse, status: number, error: unknown): void => {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain");
  response.end(error instanceof Error ? (error.stack ?? error.message) : String(error));
};

const handle = async (
  server: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/analysis") return sendError(response, 404, `No route ${url.pathname}`);
  const file = url.searchParams.get("file");
  if (!file) return sendError(response, 400, "Missing file");
  const { getViewFile, getAnalyzerJson } = await loadViewModel(server);
  if (url.searchParams.get("format") === "json")
    return sendText(response, getAnalyzerJson(resolve(file)));
  sendJson(response, getViewFile(resolve(file)));
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
