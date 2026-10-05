import { IsCallable, Value, type ObjectValue } from "#engine";
import { TimerQueue } from "../evaluate/timers.js";
import { objectValue } from "../evaluate/values.js";
import { readSnapshot, type RuntimeSnapshot } from "../harness/snapshot.js";
import { computeRenderStats } from "../render/render-stats.js";
import { normalizeRenderInputs } from "../render/normalize-inputs.js";
import type { StaticRenderResult, EngineRenderEvidence } from "../render/types.js";
import type { StaticObjectValue } from "../types.js";
import { bundleApplication, type EngineBundleOptions } from "./bundle-application.js";
import { createBrowserPlatform } from "./browser-platform.js";
import { installCompatibility } from "./compatibility.js";
import { EngineApplicationError, EngineRuntime } from "./engine-runtime.js";
import { EngineMembrane } from "./membrane.js";
import { getRandomSetup } from "./random.js";
import { createEngineInput } from "./input-values.js";
import { EngineLimitError, EngineUnsupportedError } from "./unsupported.js";

export interface EngineRenderRequest extends EngineBundleOptions {
  props?: StaticObjectValue;
  documentShell?: string | null;
  unsupported?: string;
}

const getEmptySnapshot = (): RuntimeSnapshot => ({
  reactVersion: null,
  rendererName: null,
  buildType: null,
  capturedAt: new Date().toISOString(),
  roots: [],
});

export const renderEngineApplication = async (
  request: EngineRenderRequest,
): Promise<StaticRenderResult> => {
  const evidence: EngineRenderEvidence = {
    status: "complete",
    engineOwnedFunctions: 0,
    nodes: 0,
    calls: 0,
    jobs: 0,
  };
  const diagnostics: StaticRenderResult["diagnostics"] = [];
  let snapshot = getEmptySnapshot();
  let commits: RuntimeSnapshot[] = [];
  let modules = 0;
  let engine: EngineRuntime | undefined;
  let browser: ReturnType<typeof createBrowserPlatform> | undefined;
  let exports: ObjectValue | undefined;
  let settle: (() => Promise<void>) | undefined;
  let readErrors: (() => void) | undefined;
  const report = (error: unknown): void => {
    const message = engine?.describeError(error) ?? String(error);
    const status =
      error instanceof EngineUnsupportedError
        ? "unsupported"
        : error instanceof EngineLimitError
          ? "incomplete"
          : "failed";
    if (evidence.status === "complete") evidence.status = status;
    diagnostics.push({ severity: "error", code: `engine-${status}`, message, location: null });
  };
  try {
    if (request.unsupported) throw new EngineUnsupportedError(request.unsupported);
    const { options } = request;
    for (const name of [
      "externalValues",
      "globals",
      "observations",
      "decisions",
      "bootstrap",
      "maxCallDepth",
      "maxComponentDepth",
      "maxFiberCount",
      "maxRecursionPerComponent",
      "timerUnderrunMs",
      "settleMs",
    ] satisfies Array<keyof typeof options>) {
      if (options[name] !== undefined)
        throw new EngineUnsupportedError(`Engine renderer option is not ported: ${name}`);
    }
    if (
      options.serverComponents ||
      options.renderIntoDocument ||
      (options.hostPlatform && options.hostPlatform !== "browser")
    )
      throw new EngineUnsupportedError("Engine rendering currently requires a client browser root");
    const bundle = await bundleApplication(request);
    modules = bundle.modules;
    evidence.bundleHash = bundle.sourceHash;
    const timers = new TimerQueue();
    browser = createBrowserPlatform(timers, {}, 1, {
      url: new URL(options.route ?? "/", options.origin ?? "https://bippy.invalid").href,
      documentShell: request.documentShell,
    });
    engine = new EngineRuntime(options.maxSteps ?? 10_000_000, timers, true);
    const runtime = engine;
    const platform = browser;
    const membrane = new EngineMembrane(runtime);
    installCompatibility(membrane);
    platform.install(membrane);
    runtime.setGlobal("setImmediate", Value.undefined);
    runtime.setGlobal("MessageChannel", Value.undefined);
    runtime.setGlobal(
      "process",
      runtime.createRecord([
        [
          "env",
          runtime.createRecord(
            Object.entries(options.environment ?? {}).map(([name, value]) => [
              name,
              runtime.createPrimitive(value),
            ]),
          ),
        ],
      ]),
    );
    runtime.evaluate(getRandomSetup(1));
    const props = createEngineInput(runtime, request.props ?? objectValue([]));
    settle = async () => {
      for (let round = 0; round < 512; round++) {
        await platform.settleOperations();
        timers.drainMicrotasks();
        if (runtime.backgroundErrors.length) throw runtime.backgroundErrors.shift();
        if (platform.errors.length) throw platform.errors.shift();
        if (!timers.hasTasks() && !timers.hasMicrotasks()) return;
        timers.runNextTask();
      }
      throw new EngineLimitError("task");
    };
    exports = runtime.getObject(runtime.evaluate(bundle.source));
    const module = exports;
    readErrors = () => {
      for (const error of runtime.getArray(runtime.call(runtime.get(module, "takeErrors"), [])))
        report(new EngineApplicationError(error));
    };
    const owned = runtime.getArray(runtime.get(exports, "owned"));
    evidence.engineOwnedFunctions = owned.filter(
      (value) => IsCallable(value) && membrane.getHostObject(value) === undefined,
    ).length;
    if (evidence.engineOwnedFunctions !== owned.length || owned.length < 3)
      throw new Error("React renderer escaped engine ownership");
    runtime.call(runtime.get(exports, "start"), [props]);
    await settle();
    const observation = runtime.getObject(runtime.call(runtime.get(exports, "observe"), []));
    snapshot = readSnapshot(membrane.toHost(runtime.get(observation, "snapshot")));
    commits = runtime
      .getArray(runtime.get(observation, "commits"))
      .map((value) => readSnapshot(membrane.toHost(value)));
    readErrors();
    if (runtime.unhandledRejections.size)
      report(
        new Error(`${runtime.unhandledRejections.size} unhandled engine Promise rejection(s)`),
      );
    if (!commits.length) report(new Error("No React root committed during engine execution"));
  } catch (error) {
    report(error);
  } finally {
    if (engine && exports && !engine.isFailed) {
      try {
        engine.call(engine.get(exports, "unmount"), []);
        await settle?.();
        readErrors?.();
      } catch (error) {
        report(error);
      }
    }
    if (engine) Object.assign(evidence, engine.metrics);
    engine?.dispose();
    try {
      await browser?.dispose();
    } catch (error) {
      report(error);
    }
  }
  return normalizeRenderInputs({
    snapshot,
    commits,
    diagnostics,
    stats: computeRenderStats(snapshot, modules),
    engine: evidence,
  });
};
