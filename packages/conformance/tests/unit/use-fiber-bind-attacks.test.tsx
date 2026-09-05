import { useFiber } from "../../../bippy/src/index.js";
import { _renderers } from "../../../bippy/src/rdt-hook.js";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { inspectHooks } from "../../../bippy/src/source/index.js";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  type ReactBuildMode,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime.js";
import { runNodeScript } from "./run-node-script.js";
import {
  checkCallingFiber,
  createFiberRootRegistry,
  getDevToolsCurrentFiber,
  matchByProps,
} from "./use-fiber-oracle.js";

interface ProbeProps {
  revision: number;
}

interface FrozenBindReport {
  mismatches: unknown[];
  didThrow: boolean;
  isBindOriginal: boolean;
  observedFibers: Array<"fiber" | "undefined">;
  rendered: string;
}

const originalBind = Function.prototype.bind;
const packageRequire = createRequire(import.meta.url);
const oracleUrl = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "use-fiber-oracle.ts"),
).href;

const restoreBind = (): void => {
  Object.defineProperty(Function.prototype, "bind", {
    configurable: true,
    enumerable: false,
    value: originalBind,
    writable: true,
  });
};

const renderProbe = (revisions: number[]) => {
  const registry = createFiberRootRegistry();
  const container = document.createElement("div");
  document.body.appendChild(container);
  registry.addContainer(container);
  const observed: Array<{ fiber: Fiber | undefined; mismatch: unknown }> = [];
  const Probe = (props: ProbeProps) => {
    const fiber = useFiber();
    observed.push({
      fiber,
      mismatch: checkCallingFiber(registry, matchByProps(Probe, props), fiber, true),
    });
    return <i>{props.revision}</i>;
  };
  const rendered = render(<Probe revision={revisions[0]} />, { container });
  for (const revision of revisions.slice(1)) rendered.rerender(<Probe revision={revision} />);
  return observed;
};

afterEach(() => {
  cleanup();
  restoreBind();
});

afterAll(removeIsolatedReactRuntimes);

describe("Function.prototype.bind interception", () => {
  it("captures the exact fiber when bind is a normal data property", () => {
    const observed = renderProbe([1, 2, 3]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null, null]);
  });

  it("captures without DevTools and only patches bind on mount", () => {
    const snapshots = [..._renderers].map((renderer) => ({
      renderer,
      getCurrentFiber: renderer.getCurrentFiber,
    }));
    let storedBind = originalBind;
    let assignments = 0;
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => storedBind,
      set: (value) => {
        assignments++;
        storedBind = value;
      },
    });
    try {
      for (const { renderer } of snapshots) renderer.getCurrentFiber = () => null;
      const observed = renderProbe([1, 2, 3]);
      expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null, null]);
      expect(assignments).toBe(2);
      expect(storedBind).toBe(originalBind);
    } finally {
      for (const { renderer, getCurrentFiber } of snapshots) {
        if (getCurrentFiber) renderer.getCurrentFiber = getCurrentFiber;
        else delete renderer.getCurrentFiber;
      }
    }
  });

  it("captures through DevTools when bind is non-writable", () => {
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      value: originalBind,
      writable: false,
    });
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null]);
    expect(Function.prototype.bind).toBe(originalBind);
  });

  it("still captures through an accessor-based bind that stores assignments", () => {
    let storedBind = originalBind;
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => storedBind,
      set: (value) => {
        storedBind = value;
      },
    });
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null]);
    expect(storedBind).toBe(originalBind);
  });

  it("captures through DevTools when a bind accessor ignores assignments", () => {
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => originalBind,
      set: () => {},
    });
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null]);
  });

  it("captures through DevTools without assigning to a throwing bind setter", () => {
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => originalBind,
      set: () => {
        throw new Error("bind is locked");
      },
    });
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null]);
  });

  it("wraps and restores a bind that another tool patched first", () => {
    let wrapperCalls = 0;
    const wrappedBind = function (this: Function, ...boundArguments: unknown[]) {
      wrapperCalls += 1;
      return Reflect.apply(originalBind, this, boundArguments);
    };
    Function.prototype.bind = wrappedBind;
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null]);
    expect(wrapperCalls).toBeGreaterThan(0);
    expect(Function.prototype.bind).toBe(wrappedBind);
  });

  it("keeps a bind that another tool swapped during the capture window", () => {
    const replacementBind = function (this: Function, ...boundArguments: unknown[]) {
      return Reflect.apply(originalBind, this, boundArguments);
    };
    const lazyPatchingBind = function (this: Function, ...boundArguments: unknown[]) {
      Function.prototype.bind = replacementBind;
      return Reflect.apply(originalBind, this, boundArguments);
    };
    Function.prototype.bind = lazyPatchingBind;
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ mismatch }) => mismatch)).toEqual([null, null]);
    expect(Function.prototype.bind).toBe(replacementBind);
  });

  it("restores bind when the captured hook throws outside of render", () => {
    expect(() => useFiber()).toThrow();
    expect(Function.prototype.bind).toBe(originalBind);
  });

  it("survives a DevTools-style hook inspection re-render", () => {
    const Probe = (props: Record<string, unknown>) => {
      useFiber();
      React.useState(props.revision);
      return null;
    };
    render(<Probe revision={1} />);
    const hooks = inspectHooks(Probe, { revision: 1 });
    expect(hooks.length).toBeGreaterThanOrEqual(2);
    expect(Function.prototype.bind).toBe(originalBind);
  });

  it("returns the fiber React DevTools reports as currently rendering", () => {
    const observed: Array<[Fiber | undefined, Fiber | null]> = [];
    const Probe = () => {
      observed.push([useFiber(), getDevToolsCurrentFiber()]);
      return null;
    };
    const rendered = render(<Probe />);
    rendered.rerender(<Probe />);
    expect(observed.length).toBeGreaterThanOrEqual(2);
    for (const [fiber, devToolsFiber] of observed) {
      expect(devToolsFiber).not.toBeNull();
      expect(fiber).toBe(devToolsFiber);
    }
  });
});

const createFrozenBindScript = (
  fixture: (typeof reactVersionFixtures)[number],
  mode: ReactBuildMode,
  shouldFreezeBeforeMount: boolean,
  lockMode: "freeze" | "throwing-setter",
): string => {
  const runtime = createIsolatedReactRuntime(fixture);
  return `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, mode)}
    const { checkCallingFiber, createFiberRootRegistry, matchByProps } = await import(${JSON.stringify(oracleUrl)});
    const registry = createFiberRootRegistry();
    const mismatches = [];
    const originalBind = Function.prototype.bind;
    const lockBind = () => {
      if (${JSON.stringify(lockMode)} === "freeze") Object.freeze(Function.prototype);
      else Object.defineProperty(Function.prototype, "bind", {
        configurable: true,
        get: () => originalBind,
        set: () => { throw new Error("bind is locked"); },
      });
    };
    if (${shouldFreezeBeforeMount}) lockBind();
    const observedFibers = [];
    let didThrow = false;
    let update = () => {};
    const Probe = (props) => {
      try {
        const fiber = Bippy.useFiber();
        observedFibers.push(fiber === undefined ? "undefined" : "fiber");
        if (fiber !== undefined) {
          mismatches.push(checkCallingFiber(registry, matchByProps(Probe, props), fiber, ${mode === "development"}));
        }
      } catch (error) {
        didThrow = true;
        throw error;
      }
      const [revision, setRevision] = React.useState(0);
      update = () => ReactDOM.flushSync(() => setRevision((value) => value + 1));
      return React.createElement("i", null, revision);
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);
    if (ReactDOMClient) {
      const root = ReactDOMClient.createRoot(container);
      ReactDOM.flushSync(() => root.render(React.createElement(Probe)));
    } else {
      ReactDOM.render(React.createElement(Probe), container);
    }
    lockBind();
    update();
    update();
    console.log("__REPORT__" + JSON.stringify({
      mismatches,
      didThrow,
      isBindOriginal: Function.prototype.bind === originalBind,
      observedFibers,
      rendered: container.textContent,
    }));
    process.exit(0);
  `;
};

const frozenBindModes: ReactBuildMode[] = ["development", "production", "profiling"];

const bindLockModes: Array<"freeze" | "throwing-setter"> = ["freeze", "throwing-setter"];

describe.each(reactVersionFixtures)("locked Function.prototype.bind on React $label", (fixture) => {
  describe.each(bindLockModes)("%s", (lockMode) => {
    describe.each(frozenBindModes)("%s", (mode) => {
      it.each([true, false])(
        "preserves rendering when frozen before mount: %s",
        (shouldFreezeBeforeMount) => {
          const result = runNodeScript(
            createFrozenBindScript(fixture, mode, shouldFreezeBeforeMount, lockMode),
            {
              environment: { NODE_ENV: mode === "development" ? "development" : "production" },
              timeout: 60_000,
            },
          );
          const reportLine = result.stdout
            .split("\n")
            .find((line) => line.startsWith("__REPORT__"));
          expect(result.status, result.stderr).toBe(0);
          const report: FrozenBindReport = JSON.parse(
            reportLine?.slice("__REPORT__".length) ?? "{}",
          );
          const mountedResult =
            shouldFreezeBeforeMount && mode !== "development" ? "undefined" : "fiber";
          const updatedResult = mountedResult;
          expect(report.didThrow).toBe(false);
          expect(report.isBindOriginal).toBe(true);
          expect(report.observedFibers).toEqual([mountedResult, updatedResult, updatedResult]);
          expect(report.mismatches).toEqual(
            report.observedFibers.filter((result) => result === "fiber").map(() => null),
          );
          expect(report.rendered).toBe("2");
        },
        70_000,
      );
    });
  });
});

describe("duplicate React copies", () => {
  it("fails with React's invalid hook call rather than a bippy-specific error", () => {
    const fixture = reactVersionFixtures.find(({ label }) => label === "18");
    if (!fixture) throw new Error("React 18 fixture missing");
    const runtime = createIsolatedReactRuntime(fixture);
    const rootReactUrl = pathToFileURL(packageRequire.resolve("react")).href;
    const rootReactDOMClientUrl = pathToFileURL(packageRequire.resolve("react-dom/client")).href;
    const script = `
      ${createBrowserBootstrapScript()}
      ${createReactImportScript(runtime, fixture, "development")}
      const OtherReact = (await import(${JSON.stringify(rootReactUrl)})).default;
      const OtherReactDOMClient = (await import(${JSON.stringify(rootReactDOMClientUrl)})).default;
      const originalBind = Function.prototype.bind;
      let renderError = null;
      const Probe = () => {
        try {
          Bippy.useFiber();
        } catch (error) {
          renderError = error;
          throw error;
        }
        return null;
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const previousConsoleError = console.error;
      console.error = () => {};
      try {
        const root = OtherReactDOMClient.createRoot(container);
        root.render(OtherReact.createElement(Probe));
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      } catch {}
      console.error = previousConsoleError;
      console.log("__REPORT__" + JSON.stringify({
        isBindOriginal: Function.prototype.bind === originalBind,
        message: renderError ? String(renderError.message) : null,
        versions: [React.version, OtherReact.version],
      }));
      process.exit(0);
    `;
    const result = runNodeScript(script, {
      environment: { NODE_ENV: "development" },
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
    const report = JSON.parse(reportLine?.slice("__REPORT__".length) ?? "{}");
    expect(report.versions[0]).not.toBe(report.versions[1]);
    expect(report.message).toMatch(/Invalid hook call|Cannot read properties of null/);
    expect(report.isBindOriginal).toBe(true);
  }, 70_000);
});
