import { createRequire } from "node:module";
import type { ReactNode } from "react";
import type { Value } from "#engine";
import type { ReactRuntime } from "../../src/materialize/react-runtime.js";
import { createReactModuleLoader } from "../../src/materialize/react-modules.js";
import { EngineRuntime } from "../../src/engine/engine-runtime.js";
import { EngineMembrane } from "../../src/engine/membrane.js";
import { EngineUnsupportedError as ExperimentUnsupportedError } from "../../src/engine/unsupported.js";

const require = createRequire(import.meta.url);

export const createReactModules = (react: ReactRuntime["react"]): Map<string, unknown> => {
  const paths = {
    react: require.resolve("react"),
    dom: require.resolve("react-dom"),
    client: require.resolve("react-dom/client"),
    server: require.resolve("react-dom/server"),
  };
  const load = createReactModuleLoader(paths);
  if (load(paths.react) !== react)
    throw new ExperimentUnsupportedError("React library/renderer identity mismatch");
  const modules = new Map<string, unknown>([["react", react]]);
  for (const name of [
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react/compiler-runtime",
    "react-dom",
  ])
    modules.set(name, load(require.resolve(name)));
  for (const name of ["events", "stream", "path", "util", "buffer"]) {
    const exports: unknown = require(`node:${name}`);
    modules.set(name, exports);
    modules.set(`node:${name}`, exports);
  }
  return modules;
};

export const getModule = (modules: Map<string, unknown>, name: string): unknown => {
  if (!modules.has(name))
    throw new ExperimentUnsupportedError(`Unsupported experiment import: ${name}`);
  return modules.get(name);
};

export class EngineReactBridge {
  readonly membrane: EngineMembrane;

  constructor(
    readonly engine: EngineRuntime,
    readonly react: ReactRuntime["react"],
  ) {
    this.membrane = new EngineMembrane(engine);
    const modules = createReactModules(react);
    engine.setGlobal("__engineReact", this.membrane.toEngine(react));
    engine.setGlobal(
      "__engineRequire",
      this.membrane.toEngine((name: string) => getModule(modules, name)),
    );
  }

  createRoot = (component: Value, props: Record<string, unknown>): ReactNode => {
    const element: unknown = Reflect.apply(this.react.createElement, this.react, [
      this.membrane.toHost(component),
      props,
    ]);
    if (!this.react.isValidElement(element)) throw new Error("Expected React element");
    return element;
  };
}
