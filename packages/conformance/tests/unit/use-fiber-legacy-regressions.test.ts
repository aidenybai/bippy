import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  type ReactBuildMode,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime.js";
import { runNodeScript } from "./run-node-script.js";

interface LegacyRegressionReport {
  afterSuspenseMismatch: unknown;
  bailoutMismatch: unknown;
  mountMismatch: unknown;
  scheduledEffectsOnUpdate: number;
}

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const oracleUrl = pathToFileURL(resolve(testsDirectory, "use-fiber-oracle.ts")).href;
const legacyFixtures = reactVersionFixtures.filter(({ major }) => major < 18);
const buildModes: ReactBuildMode[] = ["development", "production"];

// React 17 binds the Fiber only on mount, so these cover the update paths where the old
// ref-parity fallback returned the committed alternate instead of the rendering Fiber.
const createRegressionScript = (fixture: (typeof legacyFixtures)[number], mode: ReactBuildMode) => {
  const runtime = createIsolatedReactRuntime(fixture);
  return `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, mode)}
    const { checkCallingFiber, createFiberRootRegistry, matchByProps } = await import(${JSON.stringify(oracleUrl)});
    const isDevelopment = ${JSON.stringify(mode === "development")};
    const registry = createFiberRootRegistry();
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);

    let lastMismatch = null;
    let updateProbe = () => {};
    let shouldSuspend = false;
    let resolveSuspense = () => {};
    const suspensePromise = new Promise((resolvePromise) => {
      resolveSuspense = resolvePromise;
    });
    const Probe = (props) => {
      const fiber = Bippy.useFiber();
      lastMismatch = checkCallingFiber(registry, matchByProps(Probe, props), fiber, isDevelopment);
      const [, setRevision] = React.useState(0);
      updateProbe = () => ReactDOM.flushSync(() => setRevision((revision) => revision + 1));
      if (shouldSuspend) throw suspensePromise;
      return null;
    };
    const MemoProbe = React.memo(Probe);
    let updateParent = () => {};
    const Parent = () => {
      const [revision, setRevision] = React.useState(0);
      updateParent = () => ReactDOM.flushSync(() => setRevision((value) => value + 1));
      return React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement("div", { "data-revision": revision }, React.createElement(MemoProbe)),
      );
    };

    ReactDOM.render(React.createElement(Parent), container);
    const mountMismatch = lastMismatch;

    updateParent();
    updateProbe();
    const bailoutMismatch = lastMismatch;

    const probeFiber = (() => {
      const root = container._reactRootContainer._internalRoot;
      let fiber = root.current;
      while (fiber && fiber.type !== Probe) fiber = fiber.child;
      return fiber;
    })();
    let scheduledEffectsOnUpdate = 0;
    const lastEffect = probeFiber.updateQueue?.lastEffect;
    if (lastEffect) {
      let effect = lastEffect;
      do {
        effect = effect.next;
        if (effect.tag & 1) scheduledEffectsOnUpdate += 1;
      } while (effect !== lastEffect);
    }

    shouldSuspend = true;
    updateProbe();
    shouldSuspend = false;
    resolveSuspense();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    updateProbe();
    const afterSuspenseMismatch = lastMismatch;

    console.log("__REPORT__" + JSON.stringify({
      afterSuspenseMismatch,
      bailoutMismatch,
      mountMismatch,
      scheduledEffectsOnUpdate,
    }));
    process.exit(0);
  `;
};

afterAll(removeIsolatedReactRuntimes);

describe.each(legacyFixtures)("React $label useFiber reducer fallback", (fixture) => {
  it.each(buildModes)(
    "returns the rendering fiber after bailouts and suspensions in %s",
    (mode) => {
      const result = runNodeScript(createRegressionScript(fixture, mode), {
        environment: { NODE_ENV: mode },
        timeout: 60_000,
      });
      expect(result.status, result.stderr).toBe(0);
      const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
      const report: LegacyRegressionReport = JSON.parse(
        reportLine?.slice("__REPORT__".length) ?? "{}",
      );
      expect(report.mountMismatch).toBeNull();
      expect(report.bailoutMismatch).toBeNull();
      expect(report.afterSuspenseMismatch).toBeNull();
      expect(report.scheduledEffectsOnUpdate).toBe(0);
    },
    70_000,
  );
});
