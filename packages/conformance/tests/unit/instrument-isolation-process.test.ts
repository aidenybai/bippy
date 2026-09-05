import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  earlyReactVersionFixtures,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
  type ReactBuildMode,
} from "./isolated-react-runtime.js";
import { runNodeScript } from "./run-node-script.js";

const buildModes: ReactBuildMode[] = ["development", "production", "profiling"];

afterAll(removeIsolatedReactRuntimes);

describe.each([...earlyReactVersionFixtures, ...reactVersionFixtures])(
  "React $label listener isolation",
  (fixture) => {
    it.each(buildModes)(
      "keeps injection and future commits connected in %s",
      (mode) => {
        const runtime = createIsolatedReactRuntime(fixture);
        const script = `
      import assert from "node:assert/strict";
      ${createBrowserBootstrapScript()}
      const Bippy = await import(${JSON.stringify(runtime.bippyEntryUrl)});
      const listenerError = new Error("listener failure");
      let failures = 0;
      let reportedErrors = 0;
      let activations = 0;
      let injections = 0;
      let commits = 0;
      let unmounts = 0;
      console.error = (...values) => { if (values.includes(listenerError)) reportedErrors++; };
      const fail = () => { failures++; throw listenerError; };
      const unsubscribeFailure = Bippy.instrument({
        onActive: fail,
        onCommitFiberRoot: fail,
        onCommitFiberUnmount: fail,
        onPostCommitFiberRoot: fail,
        onScheduleFiberRoot: fail,
      });
      const unsubscribeInjectionFailure = Bippy.onRendererInject(fail);
      const unsubscribeLater = Bippy.instrument({
        onActive: () => { activations++; },
        onCommitFiberRoot: () => { commits++; },
        onCommitFiberUnmount: () => { unmounts++; },
      });
      const unsubscribeInjectionLater = Bippy.onRendererInject(() => { injections++; });
      const ReactModule = await import(${JSON.stringify(runtime.reactUrl)});
      const React = ReactModule.default ?? ReactModule;
      const ReactDOMModule = await import(${JSON.stringify(mode === "profiling" ? runtime.reactDOMProfilingUrl : runtime.reactDOMUrl)});
      const ReactDOM = ReactDOMModule.default ?? ReactDOMModule;
      const ReactDOMClientModule = ${fixture.major >= 18 ? (mode === "profiling" ? "ReactDOMModule" : `await import(${JSON.stringify(runtime.reactDOMClientUrl)})`) : "null"};
      const ReactDOMClient = ReactDOMClientModule?.default ?? ReactDOMClientModule;
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient?.createRoot(container);
      const Probe = ({ label }) => {
        React.useEffect(() => () => {}, []);
        return React.createElement("span", null, label);
      };
      for (const label of ["mount", "update"]) {
        ReactDOM.flushSync(() => {
          const element = React.createElement(Probe, { label });
          if (root) root.render(element);
          else ReactDOM.render(element, container);
        });
        assert.equal(container.textContent, label);
        assert.equal(commits, label === "mount" ? 1 : 2);
        assert.equal(Bippy._fiberRoots.size, 1);
      }
      ReactDOM.flushSync(() => {
        if (root) root.unmount();
        else ReactDOM.unmountComponentAtNode(container);
      });
      assert.equal(commits, 3);
      assert.equal(activations, 1);
      assert.equal(injections, 1);
      assert.ok(unmounts > 0);
      assert.ok(failures >= 5);
      assert.equal(reportedErrors, failures);
      assert.equal(Bippy._fiberRoots.size, 0);
      unsubscribeFailure();
      unsubscribeInjectionFailure();
      unsubscribeLater();
      unsubscribeInjectionLater();
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
