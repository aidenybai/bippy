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

afterAll(removeIsolatedReactRuntimes);

describe.each([...earlyReactVersionFixtures, ...reactVersionFixtures])(
  "React $label rendered traversal",
  (fixture) => {
    it.each(buildModes)(
      "visits every visible Suspense sibling in %s",
      (mode) => {
        const runtime = createIsolatedReactRuntime(fixture);
        const script = `
      import assert from "node:assert/strict";
      ${createBrowserBootstrapScript()}
      ${createReactImportScript(runtime, fixture, mode)}
      const observed = [];
      const Leaf = () => null;
      const never = new Promise(() => {});
      const Suspend = () => { throw never; };
      const unsubscribe = Bippy.instrument({ onCommitFiberRoot: (_rendererId, root) => {
        Bippy.traverseRenderedFibers(root, (fiber, phase) => {
          if (fiber.type === Leaf) observed.push({ label: fiber.memoizedProps.label, phase });
        });
      } });
      for (const shouldSuspend of [false, true]) {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = ReactDOMClient?.createRoot(container);
        for (let revision = 0; revision < 2; revision++) {
          observed.length = 0;
          const createLeaves = (prefix) => ["first", "second"].map((label) => React.createElement(Leaf, {
            key: label,
            label: prefix + "-" + label + "-" + revision,
          }));
          const element = React.createElement(React.Suspense, { fallback: createLeaves("fallback") },
            ...createLeaves("primary"), shouldSuspend ? React.createElement(Suspend, { key: "suspend" }) : null);
          ReactDOM.flushSync(() => {
            if (root) root.render(element);
            else ReactDOM.render(element, container);
          });
          const prefix = shouldSuspend ? "fallback" : "primary";
          assert.deepEqual(observed, ["first", "second"].map((label) => ({
            label: prefix + "-" + label + "-" + revision,
            phase: revision === 0 ? "mount" : "update",
          })));
        }
        ReactDOM.flushSync(() => {
          if (root) root.unmount();
          else ReactDOM.unmountComponentAtNode(container);
        });
        container.remove();
      }
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
