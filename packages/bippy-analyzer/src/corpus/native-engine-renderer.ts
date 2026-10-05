import { dirname } from "node:path";
import { bundleApplication } from "../engine/bundle-application.js";
import { EngineLimitError } from "../engine/unsupported.js";
import { getRandomSetup } from "../engine/random.js";
import { createEngineConsole } from "../engine/console.js";
import { createBrowserPlatform } from "../engine/browser-platform.js";
import { TimerQueue } from "../evaluate/timers.js";
import { readSnapshot, type RuntimeSnapshot } from "../harness/snapshot.js";
import { StaticRenderer } from "../render/static-renderer.js";

export interface EngineCorpusObservation {
  bundleHash?: string;
  commits: RuntimeSnapshot[];
  errors: string[];
}

export const renderNativeEngineWitness = async (
  filePath: string,
): Promise<EngineCorpusObservation> => {
  const renderer = new StaticRenderer({ rootDirectory: dirname(filePath), execution: "engine" });
  const bundle = await bundleApplication({
    graph: renderer.graph,
    options: renderer.options,
    filePath,
    exportName: "default",
  });
  const timers = new TimerQueue();
  const browser = createBrowserPlatform(timers);
  const errors: string[] = [];
  const rejections = new Map<Promise<unknown>, unknown>();
  const reject = (error: unknown, promise: Promise<unknown>) => {
    rejections.set(promise, error);
  };
  const handle = (promise: Promise<unknown>) => {
    rejections.delete(promise);
  };
  process.on("unhandledRejection", reject);
  process.on("rejectionHandled", handle);
  Object.assign(browser.view, {
    setImmediate: undefined,
    MessageChannel: undefined,
    process: { env: {} },
    console: createEngineConsole(),
  });
  let exports: unknown;
  const call = (name: string, ...args: unknown[]): unknown => {
    if (!exports || typeof exports !== "object") throw new Error("Missing native witness exports");
    const callback: unknown = Reflect.get(exports, name);
    if (typeof callback !== "function") throw new Error(`Missing native witness method: ${name}`);
    return Reflect.apply(callback, undefined, args);
  };
  const settle = async () => {
    for (let round = 0; round < 512; round++) {
      await browser.settleOperations();
      timers.drainMicrotasks();
      if (browser.errors.length) throw browser.errors.shift();
      if (!timers.hasTasks() && !timers.hasMicrotasks()) return;
      timers.runNextTask();
    }
    throw new EngineLimitError("native witness task");
  };
  const readErrors = () => {
    const pending = call("takeErrors");
    if (!Array.isArray(pending)) throw new Error("Invalid native witness errors");
    errors.push(...pending.map(String));
  };
  try {
    exports = Reflect.apply(
      new Function(
        "scope",
        `with(scope){${getRandomSetup(1)}${bundle.source}\nreturn __bippyEngineApplication;}`,
      ),
      browser.view,
      [browser.view],
    );
    call("start", {});
    await settle();
    const observation = call("observe");
    if (!observation || typeof observation !== "object")
      throw new Error("Missing native witness observation");
    const snapshots: unknown = Reflect.get(observation, "commits");
    if (!Array.isArray(snapshots)) throw new Error("Invalid native witness snapshots");
    readErrors();
    return { bundleHash: bundle.sourceHash, commits: snapshots.map(readSnapshot), errors };
  } finally {
    try {
      if (exports) {
        call("unmount");
        await settle();
        readErrors();
      }
      errors.push(...Array.from(rejections.values(), String));
    } finally {
      process.off("unhandledRejection", reject);
      process.off("rejectionHandled", handle);
      await browser.dispose();
    }
  }
};
