import { readFileSync } from "node:fs";
import path from "node:path";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";
import type { MessagePort } from "node:worker_threads";
import { transformSync } from "esbuild";
import { VitePluginError } from "../errors.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import type { ModuleBundler } from "../types.js";
import { findViteConfig } from "./vite-config.js";
import type {
  VitePluginRequest,
  VitePluginResponse,
  VitePluginWorkerData,
} from "./vite-plugin-worker.js";

const WORKER_SOURCE_PATH = path.join(import.meta.dirname, "vite-plugin-worker.ts");
const RESPONSE_TIMEOUT_MS = 60_000;

const readWorkerScript = (): string =>
  transformSync(readFileSync(WORKER_SOURCE_PATH, "utf8"), { loader: "ts", format: "cjs" }).code;

/**
 * The modules the app's own Vite plugins produce for files no built-in loader
 * handles (a README a plugin turns into metadata exports). Vite runs the
 * plugins' asynchronous `load` and `transform` hooks in a worker; each read
 * blocks until the worker answers.
 */
export class VitePluginModules {
  private worker: Worker | null = null;
  private readonly port: MessagePort;
  private readonly workerPort: MessagePort;
  private readonly signal = new Int32Array(new SharedArrayBuffer(4));
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly rootDirectory: string,
    private readonly configFile: string,
    private readonly viteEntry: string,
  ) {
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.workerPort = channel.port2;
  }

  /** The module source Vite's plugins emit for `id` (`filePath` plus its import query), or `null` when no plugin claims it. */
  load(filePath: string, id: string): string | null {
    const request: VitePluginRequest = { id, filePath };
    Atomics.store(this.signal, 0, 0);
    this.getWorker();
    this.port.postMessage(request);
    if (Atomics.wait(this.signal, 0, 0, RESPONSE_TIMEOUT_MS) === "timed-out") {
      throw new VitePluginError(
        `Vite plugins did not answer for ${id} within ${RESPONSE_TIMEOUT_MS}ms`,
      );
    }
    const reply = receiveMessageOnPort(this.port);
    if (!reply) throw new VitePluginError(`Vite plugins signalled without a reply for ${id}`);
    const response: VitePluginResponse = reply.message;
    switch (response.kind) {
      case "code":
        return response.code;
      case "none":
        return null;
      case "error":
        this.failures.set(filePath, response.message);
        return null;
    }
  }

  /** Why the plugins failed to produce `filePath`, when they threw. */
  getFailure(filePath: string): string | null {
    return this.failures.get(filePath) ?? null;
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const workerData: VitePluginWorkerData = {
      rootDirectory: this.rootDirectory,
      configFile: this.configFile,
      viteEntry: this.viteEntry,
      port: this.workerPort,
      signal: this.signal,
    };
    this.worker = new Worker(readWorkerScript(), {
      eval: true,
      workerData,
      transferList: [this.workerPort],
      stdout: true,
      stderr: true,
    });
    this.worker.stdout.resume();
    this.worker.stderr.resume();
    this.worker.unref();
    return this.worker;
  }
}

export const createVitePluginModules = (
  rootDirectory: string,
  bundler: ModuleBundler,
): VitePluginModules | null => {
  if (bundler !== "vite") return null;
  const configFile = findViteConfig(rootDirectory);
  const viteEntry = getInstalledModules(rootDirectory).resolve("vite");
  return configFile === undefined || viteEntry === null
    ? null
    : new VitePluginModules(rootDirectory, configFile, viteEntry);
};
