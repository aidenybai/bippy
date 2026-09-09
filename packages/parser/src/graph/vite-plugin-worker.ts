import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";

/**
 * Runs the app's own Vite plugins in a worker so their asynchronous `load` and
 * `transform` hooks can answer the module graph's synchronous reads: the main
 * thread posts an id, waits on `signal`, and reads the reply.
 *
 * Self-contained on purpose: it is transpiled and evaluated as its own script.
 */
export interface VitePluginWorkerData {
  rootDirectory: string;
  configFile: string;
  viteEntry: string;
  port: MessagePort;
  signal: Int32Array;
}

export interface VitePluginRequest {
  id: string;
  filePath: string;
}

export type VitePluginResponse =
  | { kind: "code"; code: string }
  | { kind: "none" }
  | { kind: "error"; message: string };

interface HookResult {
  code?: unknown;
}

interface PluginHook {
  (this: object, ...args: unknown[]): unknown;
}

interface VitePlugin {
  name: string;
  load?: PluginHook | { handler: PluginHook };
  transform?: PluginHook | { handler: PluginHook };
}

interface ResolvedViteConfig {
  plugins: readonly VitePlugin[];
}

interface ViteModule {
  resolveConfig: (
    inlineConfig: object,
    command: string,
    defaultMode: string,
    defaultNodeEnv: string,
  ) => Promise<ResolvedViteConfig>;
}

/** Vite's own plugins (`vite:*`, `alias`, and Vite 8's rolldown `builtin:*`) are what the module graph already models. */
const isVitePlugin = (plugin: VitePlugin): boolean =>
  plugin.name === "alias" || /^(?:vite|builtin):/.test(plugin.name);

const getHandler = (hook: VitePlugin["load"]): PluginHook | null =>
  typeof hook === "function" ? hook : (hook?.handler ?? null);

const readCode = (result: unknown): string | null => {
  if (typeof result === "string") return result;
  if (typeof result !== "object" || result === null) return null;
  const { code }: HookResult = result;
  return typeof code === "string" ? code : null;
};

const hookContext = {
  meta: { watchMode: true },
  error: (error: unknown): never => {
    throw typeof error === "string" ? new Error(error) : error;
  },
  warn: (): void => {},
  addWatchFile: (): void => {},
  getModuleInfo: (): null => null,
  resolve: async (): Promise<null> => null,
};

const data: VitePluginWorkerData = workerData;
let plugins: Promise<VitePlugin[]> | null = null;

const loadPlugins = async (): Promise<VitePlugin[]> => {
  const vite: ViteModule = await import(pathToFileURL(data.viteEntry).href);
  const config = await vite.resolveConfig(
    { root: data.rootDirectory, configFile: data.configFile, logLevel: "silent" },
    "serve",
    "development",
    "development",
  );
  return config.plugins.filter((plugin) => !isVitePlugin(plugin));
};

const transform = async (request: VitePluginRequest): Promise<VitePluginResponse> => {
  plugins ??= loadPlugins();
  const userPlugins = await plugins;
  let code: string | null = null;
  for (const plugin of userPlugins) {
    const load = getHandler(plugin.load);
    if (!load) continue;
    code = readCode(await load.call(hookContext, request.id));
    if (code !== null) break;
  }
  let isTransformed = code !== null;
  code ??= readFileSync(request.filePath, "utf8");
  for (const plugin of userPlugins) {
    const transformHook = getHandler(plugin.transform);
    if (!transformHook) continue;
    const transformed = readCode(await transformHook.call(hookContext, code, request.id));
    if (transformed === null) continue;
    code = transformed;
    isTransformed = true;
  }
  return isTransformed ? { kind: "code", code } : { kind: "none" };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

parentPort?.unref();
data.port.on("message", (request: VitePluginRequest) => {
  void transform(request)
    .catch((error: unknown): VitePluginResponse => ({
      kind: "error",
      message: describeError(error),
    }))
    .then((response) => {
      data.port.postMessage(response);
      Atomics.store(data.signal, 0, 1);
      Atomics.notify(data.signal, 0);
    });
});
