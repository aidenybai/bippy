import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { type RuntimeResult, runNodeScript } from "./run-node-script.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bippyEntryUrl = pathToFileURL(resolve(packageDirectory, "../bippy/src/index.ts")).href;
const hookEntryUrl = pathToFileURL(
  resolve(packageDirectory, "../bippy/src/install-hook-only.ts"),
).href;

const runBun = (script: string): RuntimeResult | null => {
  const bunVersion = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (bunVersion.error) return null;
  const result = spawnSync("bun", ["--eval", script], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: process.env,
    timeout: 15_000,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

const createRendererReportScript = (entryUrl: string, rendererImport: string): string => `
  delete globalThis.window;
  await import(${JSON.stringify(entryUrl)});
  await import(${JSON.stringify(rendererImport)});
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  console.log(JSON.stringify({
    hasWindow: typeof globalThis.window !== "undefined",
    renderers: hook?.renderers.size,
    names: [...(hook?.renderers.values() ?? [])].map((renderer) => renderer.rendererPackageName),
  }));
  process.exit(0);
`;

describe("DOM-less renderer injection", () => {
  it("captures OpenTUI from the normal Bippy entry in Node", () => {
    const result = runNodeScript(createRendererReportScript(bippyEntryUrl, "@opentui/react"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"hasWindow":false');
    expect(result.stdout).toContain('"renderers":1');
    expect(result.stdout).toContain('"@opentui/react"');
  });

  it("captures OpenTUI from the hook-only prelude in Bun when available", () => {
    const result = runBun(createRendererReportScript(hookEntryUrl, "@opentui/react"));
    if (!result) return;
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"hasWindow":false');
    expect(result.stdout).toContain('"renderers":1');
    expect(result.stdout).toContain('"@opentui/react"');
  });

  it("preserves OpenTUI when Ink replaces the hook with React DevTools", () => {
    const script = `
      delete globalThis.window;
      await import(${JSON.stringify(bippyEntryUrl)});
      await import("@opentui/react");
      const React = await import("react");
      const { Text } = await import("ink");
      const { render } = await import("ink-testing-library");
      const instance = render(React.createElement(Text, null, "ok"));
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      console.log(JSON.stringify({
        renderers: hook?.renderers.size,
        names: [...(hook?.renderers.values() ?? [])]
          .map((renderer) => renderer.rendererPackageName)
          .sort(),
      }));
      instance.cleanup();
      process.exit(0);
    `;
    const result = runNodeScript(script, { environment: { DEV: "true" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"renderers":2');
    expect(result.stdout).toContain('"@opentui/react"');
    expect(result.stdout).toContain('"ink"');
  });
});

describe("providerless useFiber", () => {
  it("captures the calling fiber with production React", () => {
    const script = `
      const { Window } = await import("happy-dom");
      const browserWindow = new Window();
      globalThis.window = browserWindow;
      globalThis.document = browserWindow.document;
      globalThis.Node = browserWindow.Node;
      globalThis.HTMLElement = browserWindow.HTMLElement;
      const Bippy = await import(${JSON.stringify(bippyEntryUrl)});
      globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE = () => {};
      const React = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { flushSync } = await import("react-dom");
      let observedFiber;
      let initialFiber;
      let stateInitializerCalls = 0;
      const originalBind = Function.prototype.bind;
      const Probe = ({ revision }) => {
        observedFiber = Bippy.useFiber();
        React.useState(() => ++stateInitializerCalls);
        return React.createElement("div", null, revision);
      };
      const root = createRoot(document.createElement("div"));
      flushSync(() => root.render(React.createElement(Probe, { revision: 1 })));
      initialFiber = observedFiber;
      flushSync(() => root.render(React.createElement(Probe, { revision: 2 })));
      console.log(JSON.stringify({
        captured: observedFiber?.type === Probe,
        latest: observedFiber !== initialFiber && Bippy.getLatestFiber(initialFiber) === observedFiber,
        stateInitializerCalls,
        restored: Function.prototype.bind === originalBind,
      }));
      root.unmount();
      process.exit(0);
    `;
    const result = runNodeScript(script, { environment: { NODE_ENV: "production" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"captured":true');
    expect(result.stdout).toContain('"latest":true');
    expect(result.stdout).toContain('"stateInitializerCalls":1');
    expect(result.stdout).toContain('"restored":true');
  });
});
