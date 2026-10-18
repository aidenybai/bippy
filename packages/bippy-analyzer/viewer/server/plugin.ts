import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { ViewFile } from "../src/model";

const serverDirectory = fileURLToPath(new URL(".", import.meta.url));

interface ViewModelModule {
  getViewFile: (file: string) => ViewFile;
  getAnalyzerJson: (file: string) => string;
  saveFile: (file: string, source: string) => ViewFile;
}

const hasFunction = (module: object, name: string): boolean =>
  typeof Reflect.get(module, name) === "function";

const isViewModelModule = (module: object): module is ViewModelModule =>
  ["getViewFile", "getAnalyzerJson", "saveFile"].every((name) => hasFunction(module, name));

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

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

interface SaveRequest {
  file: string;
  source: string;
}

const isSaveRequest = (value: unknown): value is SaveRequest =>
  typeof value === "object" &&
  value !== null &&
  "file" in value &&
  typeof value.file === "string" &&
  "source" in value &&
  typeof value.source === "string";

const handleAnalysis = async (
  server: ViteDevServer,
  url: URL,
  response: ServerResponse,
): Promise<void> => {
  const file = url.searchParams.get("file");
  if (!file) return sendError(response, 400, "Missing file");
  const { getViewFile, getAnalyzerJson } = await loadViewModel(server);
  if (url.searchParams.get("format") === "json")
    return sendText(response, getAnalyzerJson(resolve(file)));
  sendJson(response, getViewFile(resolve(file)));
};

const handleSave = async (
  server: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body: unknown = JSON.parse(await readBody(request));
  if (!isSaveRequest(body)) return sendError(response, 400, "Expected { file, source }");
  const { saveFile } = await loadViewModel(server);
  sendJson(response, saveFile(resolve(body.file), body.source));
};

const handle = async (
  server: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/api/analysis" && request.method === "GET")
    return handleAnalysis(server, url, response);
  if (url.pathname === "/api/file" && request.method === "POST")
    return handleSave(server, request, response);
  sendError(response, 404, `No route ${request.method} ${url.pathname}`);
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
