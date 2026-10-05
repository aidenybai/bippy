import { resolve } from "node:path";
import { build } from "esbuild";
import { IsCallable } from "#engine";
import { TimerQueue } from "../../src/evaluate/timers.js";
import {
  EngineApplicationError,
  EngineRuntime,
  type EngineMetrics,
} from "../../src/engine/engine-runtime.js";
import { EngineMembrane } from "../../src/engine/membrane.js";
import { VirtualClock } from "../../src/engine/virtual-clock.js";

export interface ReconcilerAction {
  type: string;
  event: string;
}

export interface ReconcilerProbeOptions {
  source: string;
  props?: Record<string, string | number | boolean | null>;
  actions?: ReconcilerAction[];
  maxNodes?: number;
}

export interface ReconcilerProbeResult {
  observation: string;
  engineOwnedFunctions: number;
  metrics: EngineMetrics | null;
  bundleBytes: number;
}

export const bundleReconcilerProbe = async (source: string): Promise<string> => {
  const output = await build({
    stdin: {
      contents: `
        import * as React from "react";
        import Reconciler from "react-reconciler";
        import * as fixture from "bippy:fixture";
        import { createReconcilerHost, serializeReconcilerObservation } from "./reconciler-host.ts";
        const host = createReconcilerHost();
        export const owned = [React.createElement, Reconciler, fixture.default, host.render];
        export const mount = (props) => host.render(React.createElement(fixture.default, props));
        export const fire = host.fire;
        export const unmount = host.unmount;
        export const observe = () => {
          const getTrace = Reflect.get(fixture, "getTrace");
          return serializeReconcilerObservation(host.observe(), typeof getTrace === "function" ? getTrace() : []);
        };
      `,
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__bippyReconciler",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
    plugins: [
      {
        name: "reconciler-fixture",
        setup: (builder) => {
          builder.onResolve({ filter: /^bippy:fixture$/ }, () => ({
            path: "fixture.tsx",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: source,
            loader: "tsx",
            resolveDir: resolve(import.meta.dirname, "fixtures"),
          }));
        },
      },
    ],
  });
  if (Object.values(output.metafile.outputs).some((entry) => entry.imports.length > 0))
    throw new Error("Reconciler probe must not import native React");
  return `${output.outputFiles[0].text}\n__bippyReconciler;`;
};

export const runReconcilerProbe = async (
  backend: "native" | "engine262",
  options: ReconcilerProbeOptions,
): Promise<ReconcilerProbeResult> => {
  const source = await bundleReconcilerProbe(options.source);
  const timers = new TimerQueue();
  const clock = new VirtualClock(timers);
  const engine =
    backend === "engine262"
      ? new EngineRuntime(options.maxNodes ?? 10_000_000, timers, true)
      : null;
  let engineOwnedFunctions = 0;
  let isDisposed = false;
  const backgroundErrors: unknown[] = [];
  try {
    const globals = {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      queueMicrotask: (callback: () => void) =>
        queueMicrotask(() => {
          if (isDisposed) return;
          try {
            callback();
          } catch (error) {
            backgroundErrors.push(error);
          }
        }),
      performance: { now: () => clock.now },
      Date: clock.createDate(),
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setImmediate: undefined,
      MessageChannel: undefined,
    };
    let exports: unknown;
    if (engine) {
      const membrane = new EngineMembrane(engine);
      for (const [name, value] of Object.entries(globals))
        engine.setGlobal(name, membrane.toEngine(value));
      const module = engine.getObject(engine.evaluate(source));
      const owned = engine.getArray(engine.get(module, "owned"));
      engineOwnedFunctions = owned.filter(
        (value) => IsCallable(value) && membrane.getHostObject(value) === undefined,
      ).length;
      exports = membrane.toHost(module);
    } else {
      exports = new Function(...Object.keys(globals), `${source}\nreturn __bippyReconciler;`)(
        ...Object.values(globals),
      );
    }
    if (typeof exports !== "object" || exports === null)
      throw new Error("Missing reconciler exports");
    const invoke = (name: string, ...args: unknown[]): unknown => {
      const callback: unknown = Reflect.get(exports, name);
      if (typeof callback !== "function") throw new Error(`Missing reconciler method: ${name}`);
      return Reflect.apply(callback, undefined, args);
    };
    const settle = async (): Promise<void> => {
      for (let count = 0; count < 512; count++) {
        await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
        if (backgroundErrors.length) throw backgroundErrors[0];
        if (engine?.backgroundErrors.length) throw engine.backgroundErrors[0];
        if (engine?.unhandledRejections.size) throw new Error("Unhandled engine Promise rejection");
        timers.drainMicrotasks();
        if (!timers.hasTasks() && !timers.hasMicrotasks()) return;
        timers.runNextTask();
      }
      throw new Error("Reconciler probe task budget exhausted");
    };
    invoke("mount", options.props ?? {});
    await settle();
    for (const action of options.actions ?? []) {
      invoke("fire", action.type, action.event);
      await settle();
    }
    const mounted = invoke("observe");
    invoke("unmount");
    await settle();
    const unmounted = invoke("observe");
    if (typeof mounted !== "string" || typeof unmounted !== "string")
      throw new Error("Invalid reconciler observation");
    return {
      observation: `{"mounted":${mounted},"unmounted":${unmounted}}`,
      engineOwnedFunctions,
      metrics: engine ? { ...engine.metrics } : null,
      bundleBytes: Buffer.byteLength(source),
    };
  } catch (error) {
    if (error instanceof EngineApplicationError && engine)
      throw new Error(engine.describeError(error));
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    isDisposed = true;
    engine?.dispose();
  }
};
