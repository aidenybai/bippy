import { useFiber } from "../../../bippy/src/index.js";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import { inspectHooks } from "../../../bippy/src/source/index.js";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
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
  didThrow: boolean;
  isBindOriginal: boolean;
  observedFibers: Array<"fiber" | "undefined">;
  rendered: string;
}

const originalBind = Function.prototype.bind;
const packageRequire = createRequire(import.meta.url);

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

  it("degrades to undefined without throwing when bind is non-writable", () => {
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      value: originalBind,
      writable: false,
    });
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ fiber }) => fiber)).toEqual([undefined, undefined]);
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

  it("degrades to undefined when an accessor-based bind ignores assignments", () => {
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => originalBind,
      set: () => {},
    });
    const observed = renderProbe([1, 2]);
    expect(observed.map(({ fiber }) => fiber)).toEqual([undefined, undefined]);
  });

  it("propagates a throwing bind setter instead of corrupting hook order", () => {
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => originalBind,
      set: () => {
        throw new Error("bind is locked");
      },
    });
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      expect(() => renderProbe([1])).toThrow("bind is locked");
    } finally {
      console.error = previousConsoleError;
    }
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

const createFrozenBindScript = (fixture: (typeof reactVersionFixtures)[number]): string => {
  const runtime = createIsolatedReactRuntime(fixture);
  return `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, "production")}
    Object.freeze(Function.prototype);
    const originalBind = Function.prototype.bind;
    const observedFibers = [];
    let didThrow = false;
    let update = () => {};
    const Probe = () => {
      try {
        observedFibers.push(Bippy.useFiber() === undefined ? "undefined" : "fiber");
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
    if (ReactDOMClient) {
      const root = ReactDOMClient.createRoot(container);
      ReactDOM.flushSync(() => root.render(React.createElement(Probe)));
    } else {
      ReactDOM.render(React.createElement(Probe), container);
    }
    update();
    update();
    console.log("__REPORT__" + JSON.stringify({
      didThrow,
      isBindOriginal: Function.prototype.bind === originalBind,
      observedFibers,
      rendered: container.textContent,
    }));
    process.exit(0);
  `;
};

describe.each(reactVersionFixtures)("frozen Function.prototype on React $label", (fixture) => {
  it("renders and updates with useFiber returning undefined", () => {
    const result = runNodeScript(createFrozenBindScript(fixture), {
      environment: { NODE_ENV: "production" },
      timeout: 60_000,
    });
    const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
    expect(result.status, result.stderr).toBe(0);
    const report: FrozenBindReport = JSON.parse(reportLine?.slice("__REPORT__".length) ?? "{}");
    expect(report.didThrow).toBe(false);
    expect(report.isBindOriginal).toBe(true);
    expect(report.observedFibers).toEqual(["undefined", "undefined", "undefined"]);
    expect(report.rendered).toBe("2");
  }, 70_000);
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
