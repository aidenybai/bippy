import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  earlyReactVersionFixtures,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
  type ReactBuildMode,
} from "./isolated-react-runtime.js";
import { runNodeScript } from "./run-node-script.js";

const buildModes: ReactBuildMode[] = ["development", "production", "profiling"];
const oracleUrl = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "use-fiber-oracle.ts"),
).href;

afterAll(removeIsolatedReactRuntimes);

describe.each([...earlyReactVersionFixtures, ...reactVersionFixtures])(
  "React $label useFiber hot paths",
  (fixture) => {
    it.each(buildModes)(
      "does not visit unrelated subtrees during %s updates",
      (mode) => {
        const runtime = createIsolatedReactRuntime(fixture);
        const script = `
      import assert from "node:assert/strict";
      ${createBrowserBootstrapScript()}
      ${createReactImportScript(runtime, fixture, mode)}
      const { checkCallingFiber, createFiberRootRegistry, matchByProps } = await import(${JSON.stringify(oracleUrl)});
      const registry = createFiberRootRegistry();
      const container = document.createElement("div");
      document.body.appendChild(container);
      registry.addContainer(container);
      const root = ReactDOMClient?.createRoot(container);
      let isCapturing = false;
      let unrelatedReads = 0;
      let checkedFibers = 0;
      const watched = new WeakSet();
      const watchSubtree = (fiber) => {
        if (!watched.has(fiber)) {
          watched.add(fiber);
          let child = fiber.child;
          Object.defineProperty(fiber, "child", {
            configurable: true,
            get: () => { if (isCapturing) unrelatedReads++; return child; },
            set: (nextChild) => { child = nextChild; },
          });
        }
        for (let child = fiber.child; child; child = child.sibling) watchSubtree(child);
      };
      const Leaf = () => null;
      const Unrelated = React.memo(() => Array.from({ length: 100 }, (_, index) => React.createElement(Leaf, { key: index })));
      const unsubscribe = Bippy.instrument({
        onCommitFiberRoot: (_rendererId, committedRoot) => {
          const unrelated = committedRoot.current.child;
          if (unrelated?.type === Unrelated || unrelated?.elementType === Unrelated) watchSubtree(unrelated);
        },
      });
      const Probe = (props) => {
        for (let hookIndex = 0; hookIndex < 32; hookIndex++) React.useRef(null);
        isCapturing = true;
        let fiber;
        try { fiber = Bippy.useFiber(); } finally { isCapturing = false; }
        assert.equal(checkCallingFiber(registry, matchByProps(Probe, props), fiber, ${mode === "development"}), null);
        checkedFibers++;
        return null;
      };
      for (let revision = 0; revision < 5; revision++) {
        const elements = [
          React.createElement(Unrelated, { key: "unrelated" }),
          ...Array.from({ length: 20 }, (_, index) => React.createElement(Probe, { key: index, revision })),
        ];
        ReactDOM.flushSync(() => {
          if (root) root.render(elements);
          else ReactDOM.render(elements, container);
        });
      }
      assert.equal(checkedFibers, 100);
      assert.equal(unrelatedReads, 0, "useFiber scanned an unrelated subtree");
      assert.ok(watched.has(registry.listRoots()[0].current.child), "unrelated subtree was not instrumented");
      ReactDOM.flushSync(() => {
        if (root) root.unmount();
        else ReactDOM.unmountComponentAtNode(container);
      });
      unsubscribe();
      process.exit(0);
    `;
        const result = runNodeScript(script, {
          environment: { NODE_ENV: mode === "development" ? "development" : "production" },
          timeout: 15000,
        });
        expect(result.status, result.stderr).toBe(0);
      },
      20000,
    );
  },
);
