import { getRandomSetup } from "../../src/engine/random.js";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import type { ReactNode } from "react";
import { EngineUnsupportedError as ExperimentUnsupportedError } from "../../src/engine/unsupported.js";
import { loadReactRuntime } from "../../src/materialize/react-runtime.js";
import { mountNode } from "../../src/materialize/mount.js";
import { TimerQueue } from "../../src/evaluate/timers.js";
import { objectFromRecord, primitiveValue } from "../../src/evaluate/values.js";
import type { StaticPrimitive } from "../../src/types.js";
import type { RuntimeSnapshot, RuntimeFiberSnapshot } from "../../src/harness/snapshot.js";
import type { EngineMetrics } from "../../src/engine/engine-runtime.js";

import { createReactModules, getModule } from "./react-bridge.js";
import { installCompatibility } from "../../src/engine/compatibility.js";
import { createBrowserPlatform, type BrowserResponse } from "../../src/engine/browser-platform.js";

export interface ProbeInteraction {
  selector: string;
  type: "click" | "input";
  value?: string;
}
export interface InteractionResult {
  selector: string;
  type: string;
  defaultPrevented: boolean;
}
export interface ProbeOptions {
  backend: "engine262" | "native" | "bippy";
  filePath: string;
  props?: Record<string, StaticPrimitive>;
  interactions?: ProbeInteraction[];
  randomSeed?: number;
  responses?: Record<string, BrowserResponse>;
}
export interface HostSnapshot {
  name: string | null;
  key: string | null;
  text: string | null;
  props: RuntimeFiberSnapshot["props"];
  children: HostSnapshot[];
}
export interface ProbeResult {
  backend: ProbeOptions["backend"];
  reactVersion: string | null;
  prepareMs: number;
  evaluateMs: number;
  mountMs: number;
  rssBytes: number;
  commits: HostSnapshot[][];
  trace: unknown[];
  metrics: EngineMetrics | null;
  errors: string[];
  caughtErrors: string[];
  hasPendingWork: boolean | null;
  unsupported: string[];
  interactions: InteractionResult[];
}

export const getHostSnapshot = (snapshot: RuntimeSnapshot): HostSnapshot[] => {
  const visit = (fiber: RuntimeFiberSnapshot): HostSnapshot[] => {
    const children = fiber.children.flatMap(visit);
    if (!["HostComponent", "HostText", "HostHoistable", "HostSingleton"].includes(fiber.tag))
      return children;
    return [{ name: fiber.name, key: fiber.key, text: fiber.text, props: fiber.props, children }];
  };
  return snapshot.roots.flatMap(visit);
};

export const compileSource = async (
  source: string,
  filePath = "component.tsx",
): Promise<string> => {
  const result = await build({
    stdin: { contents: source, sourcefile: filePath, resolveDir: dirname(filePath), loader: "tsx" },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    loader: { ".css": "text", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl" },
    external: ["react", "react/*", "react-dom", "react-dom/*", "node:*", ...builtinModules],
    jsx: "transform",
    jsxFactory: "__engineReact.createElement",
    jsxFragment: "__engineReact.Fragment",
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  if (code.length > 500_000)
    throw new ExperimentUnsupportedError("Experiment bundle exceeds 500 KB");
  return `(()=>{ "use strict"; const module={exports:{}}; const exports=module.exports; const require=__engineRequire; ${code}\n return module.exports; })()`;
};

export const runProbe = async ({
  backend,
  filePath,
  props = {},
  interactions = [],
  randomSeed = 1,
  responses = {},
}: ProbeOptions): Promise<ProbeResult> => {
  const startedAt = performance.now();
  const reactRuntime = await loadReactRuntime();
  if (backend === "bippy") {
    if (interactions.length)
      throw new ExperimentUnsupportedError("The Bippy comparison has no event driver");
    const { StaticRenderer } = await import("../../src/render/static-renderer.js");
    const renderer = new StaticRenderer({ rootDirectory: dirname(filePath) });
    const preparedAt = performance.now();
    const result = await renderer.renderComponent(filePath, {
      props: objectFromRecord(
        Object.fromEntries(
          Object.entries(props).map(([key, value]) => [key, primitiveValue(value)]),
        ),
      ),
    });
    return {
      backend,
      reactVersion: result.snapshot.reactVersion,
      prepareMs: preparedAt - startedAt,
      evaluateMs: 0,
      mountMs: performance.now() - preparedAt,
      rssBytes: process.memoryUsage().rss,
      commits: result.commits.map(getHostSnapshot),
      trace: [],
      metrics: null,
      errors: result.diagnostics.map(
        (diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`,
      ),
      caughtErrors: [],
      hasPendingWork: null,
      unsupported: [],
      interactions: [],
    };
  }
  const source = await compileSource(await readFile(filePath, "utf8"), filePath);
  const randomSetup = getRandomSetup(randomSeed);
  let node: ReactNode;
  const timers = new TimerQueue();
  const browser = createBrowserPlatform(timers, responses, randomSeed);
  let readTrace: () => unknown[];
  let readRejections: () => string[] = () => [];
  let dispose = () => {};
  let readUnsupported: () => string[] = () => [];
  let describeError: (error: unknown) => string = String;
  let metrics: EngineMetrics | null = null;
  let preparedAt: number;
  let evaluatedAt: number;
  try {
    if (backend === "engine262") {
      const { EngineRuntime, EngineApplicationError, getPrimitive } =
        await import("../../src/engine/engine-runtime.js");
      const { EngineReactBridge } = await import("./react-bridge.js");
      const engine = new EngineRuntime(undefined, timers, true);
      dispose = engine.dispose;
      try {
        const bridge = new EngineReactBridge(engine, reactRuntime.react);
        installCompatibility(bridge.membrane);
        browser.install(bridge.membrane);
        describeError = engine.describeError;
        preparedAt = performance.now();
        engine.evaluate(randomSetup);
        const exports = engine.evaluate(source);
        const { ObjectValue, IsCallable } = await import("#engine");
        if (!(exports instanceof ObjectValue)) throw new Error("Expected component exports");
        do {
          engine.timers.drainMicrotasks();
          await new Promise<void>((resolveCheckpoint) => setImmediate(resolveCheckpoint));
        } while (engine.timers.hasMicrotasks());
        node = bridge.createRoot(engine.get(exports, "default"), props);
        readUnsupported = () => [...engine.unsupported];
        metrics = engine.metrics;
        readRejections = () => [
          ...Array.from(engine.unhandledRejections, () => "Unhandled engine262 Promise rejection"),
          ...engine.backgroundErrors.map(engine.describeError),
        ];
        readTrace = () => {
          const callback = engine.get(exports, "getTrace");
          return IsCallable(callback)
            ? engine.getArray(engine.call(callback, [])).map(getPrimitive)
            : [];
        };
        evaluatedAt = performance.now();
      } catch (error) {
        const failure =
          error instanceof EngineApplicationError ? new Error(engine.describeError(error)) : error;
        throw failure;
      }
    } else {
      const modules = createReactModules(reactRuntime.react);
      Object.assign(browser.view, {
        __engineReact: reactRuntime.react,
        __engineRequire: (name: string) => getModule(modules, name),
      });
      preparedAt = performance.now();
      const exports: unknown = Reflect.apply(
        new Function("scope", `with(scope){${randomSetup}return ${source}}`),
        browser.view,
        [browser.view],
      );
      if (
        typeof exports !== "object" ||
        exports === null ||
        !("default" in exports) ||
        (typeof exports.default !== "function" && typeof exports.default !== "object")
      )
        throw new Error("Expected component exports");
      const element: unknown = Reflect.apply(reactRuntime.react.createElement, reactRuntime.react, [
        exports.default,
        props,
      ]);
      if (!reactRuntime.react.isValidElement(element))
        throw new Error("Expected a native React element");
      node = element;
      await new Promise<void>((resolveCheckpoint) => setImmediate(resolveCheckpoint));
      readTrace = () => {
        if (!("getTrace" in exports) || typeof exports.getTrace !== "function") return [];
        const trace: unknown = Reflect.apply(exports.getTrace, undefined, []);
        if (!Array.isArray(trace)) throw new Error("Expected an array trace");
        return Array.from(trace);
      };
      evaluatedAt = performance.now();
    }
  } catch (error) {
    await browser.dispose();
    dispose();
    throw error;
  }
  const hostErrors: unknown[] = [];
  const onWindowError = (event: ErrorEvent): void => {
    event.preventDefault();
    hostErrors.push(event.error ?? event.message);
  };
  browser.view.addEventListener("error", onWindowError);
  try {
    const host = browser.host;
    let container: Element | Document | null = null;
    let didSchedule = false;
    const interactionResults: InteractionResult[] = [];
    const result = await mountNode(
      {
        ...reactRuntime,
        act: (callback) =>
          reactRuntime.act(async () => {
            const result = await callback();
            await browser.settleOperations();
            return result;
          }),
      },
      {
        ...host,
        createRootContainer: () => {
          container = host.createRootContainer();
          return container;
        },
      },
      node,
      timers,
      () => {
        if (didSchedule) return;
        didSchedule = true;
        for (const interaction of interactions)
          timers.enqueue(() => {
            const target = container?.querySelector(interaction.selector);
            if (!target) throw new Error(`Interaction target not found: ${interaction.selector}`);
            if (interaction.value !== undefined) {
              const setter = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(target),
                "value",
              )?.set;
              if (!setter) throw new Error("Interaction target has no value setter");
              Reflect.apply(setter, target, [interaction.value]);
            }
            const event =
              interaction.type === "click"
                ? new browser.view.MouseEvent("click", { bubbles: true, cancelable: true })
                : new browser.view.Event("input", { bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            interactionResults.push({
              selector: interaction.selector,
              type: interaction.type,
              defaultPrevented: event.defaultPrevented,
            });
          });
      },
    );
    return {
      backend,
      reactVersion: result.snapshot.reactVersion,
      prepareMs: preparedAt - startedAt,
      evaluateMs: evaluatedAt - preparedAt,
      mountMs: performance.now() - evaluatedAt,
      rssBytes: process.memoryUsage().rss,
      commits: result.commits.map(getHostSnapshot),
      trace: readTrace(),
      metrics,
      errors: [...result.uncaughtErrors, ...hostErrors, ...browser.errors, ...readRejections()].map(
        describeError,
      ),
      caughtErrors: result.caughtErrors.map(describeError),
      hasPendingWork: result.hasPendingWork,
      unsupported: [
        ...readUnsupported(),
        ...[...result.uncaughtErrors, ...result.caughtErrors, ...hostErrors]
          .filter((error) => error instanceof ExperimentUnsupportedError)
          .map((error) => error.message),
      ],
      interactions: interactionResults,
    };
  } catch (error) {
    if (readUnsupported().length)
      throw new ExperimentUnsupportedError(readUnsupported().join("; "));
    throw error;
  } finally {
    browser.view.removeEventListener("error", onWindowError);
    await browser.dispose();
    dispose();
  }
};
