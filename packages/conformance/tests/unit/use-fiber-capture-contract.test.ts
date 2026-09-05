import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  type ReactBuildMode,
  type ReactVersionFixture,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime.js";
import { runNodeScript } from "./run-node-script.js";

interface CaptureContractReport {
  bindAssignments: number[];
  capturedDecoy: boolean;
  mismatches: unknown[];
  reducerBindings: number[];
  wasBindRestored: boolean;
}

const externalStoreFixtures = reactVersionFixtures.filter(({ major }) => major >= 18);
const buildModes: ReactBuildMode[] = ["development", "production", "profiling"];
const oracleUrl = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "use-fiber-oracle.ts"),
).href;

const createCaptureContractScript = (
  fixture: ReactVersionFixture,
  mode: ReactBuildMode,
): string => {
  const runtime = createIsolatedReactRuntime(fixture);
  return `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, mode)}
    const { checkCallingFiber, createFiberRootRegistry, matchByProps } = await import(${JSON.stringify(oracleUrl)});
    const registry = createFiberRootRegistry();
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);
    const decoy = { tag: 0, stateNode: null, return: null, child: null, sibling: null, flags: 0 };
    const opaqueArgument = new Proxy({}, { has: () => { throw new Error("opaque bound argument"); } });
    const originalBind = Function.prototype.bind;
    const originalBindDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "bind");
    const bindAssignments = [];
    let bindAssignmentCount = 0;
    const mismatches = [];
    const reducerBindings = [];
    let capturedDecoy = false;
    let isCapturing = false;
    let bindingCount = 0;
    const recordingBind = new Proxy(originalBind, {
      apply: (bind, callback, boundArguments) => {
        if (
          isCapturing &&
          boundArguments.some((argument) => typeof argument?.lastRenderedReducer === "function") &&
          boundArguments.some((argument) => Bippy.isFiber(argument))
        ) bindingCount++;
        return Reflect.apply(bind, callback, boundArguments);
      },
    });
    let currentBind = recordingBind;
    Object.defineProperty(Function.prototype, "bind", {
      configurable: true,
      get: () => currentBind,
      set: (nextBind) => { bindAssignmentCount++; currentBind = nextBind; },
    });
    const Probe = (props) => {
      decoy.return = registry.listRoots()[0].current;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ??
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      const dispatcher = internals.H ?? internals.ReactCurrentDispatcher.current;
      const originalStoreHook = dispatcher.useSyncExternalStore;
      const originalReducerHook = dispatcher.useReducer;
      dispatcher.useSyncExternalStore = () => { throw new Error("useFiber must not depend on store subscription binds"); };
      dispatcher.useReducer = new Proxy(originalReducerHook, {
        apply: (reducerHook, receiver, arguments_) => {
          Reflect.apply(Function.prototype.bind, () => {}, [null, opaqueArgument]);
          Reflect.apply(Function.prototype.bind, () => {}, [null, decoy]);
          return Reflect.apply(reducerHook, receiver, arguments_);
        },
      });
      let fiber;
      bindingCount = 0;
      const assignmentsBeforeCapture = bindAssignmentCount;
      isCapturing = true;
      try {
        fiber = Bippy.useFiber();
      } finally {
        isCapturing = false;
        dispatcher.useSyncExternalStore = originalStoreHook;
        dispatcher.useReducer = originalReducerHook;
      }
      bindAssignments.push(bindAssignmentCount - assignmentsBeforeCapture);
      reducerBindings.push(bindingCount);
      capturedDecoy ||= fiber === decoy;
      mismatches.push(checkCallingFiber(registry, matchByProps(Probe, props), fiber, ${mode === "development"}));
      return null;
    };
    const root = ReactDOMClient.createRoot(container);
    for (const revision of [0, 1, 2, 3]) {
      ReactDOM.flushSync(() => root.render(React.createElement(Probe, { revision })));
    }
    ReactDOM.flushSync(() => root.unmount());
    const wasBindRestored = Function.prototype.bind === recordingBind;
    Object.defineProperty(Function.prototype, "bind", originalBindDescriptor);
    console.log("__REPORT__" + JSON.stringify({
      bindAssignments,
      capturedDecoy,
      mismatches,
      reducerBindings,
      wasBindRestored,
    }));
    process.exit(0);
  `;
};

afterAll(removeIsolatedReactRuntimes);

describe.each(externalStoreFixtures)("React $label capture-window contract", (fixture) => {
  it.each(buildModes)(
    "ignores decoy bindings and avoids useSyncExternalStore in %s",
    (mode) => {
      const result = runNodeScript(createCaptureContractScript(fixture, mode), {
        environment: { NODE_ENV: mode === "development" ? "development" : "production" },
        timeout: 15_000,
      });
      expect(result.status, result.stderr).toBe(0);
      const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
      const report: CaptureContractReport = JSON.parse(
        reportLine?.slice("__REPORT__".length) ?? "{}",
      );
      expect(report.bindAssignments).toEqual([mode === "development" ? 0 : 2, 0, 0, 0]);
      expect(report.capturedDecoy).toBe(false);
      expect(report.mismatches).toEqual([null, null, null, null]);
      expect(report.reducerBindings).toEqual([1, 0, 0, 0]);
      expect(report.wasBindRestored).toBe(true);
    },
    20_000,
  );
});
