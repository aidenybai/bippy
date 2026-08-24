import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { type RuntimeResult, runNodeScript } from "./run-node-script.js";

interface ReactVersionFixture {
  major: number;
  reactPackageName: string;
  reactDOMPackageName: string;
}

interface IsolatedRuntime {
  bippyEntryUrl: string;
  directory: string;
  reactDOMClientUrl: string;
  reactDOMServerUrl: string;
  reactDOMUrl: string;
  reactUrl: string;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRequire = createRequire(import.meta.url);
const runtimeDirectories: string[] = [];

const reactVersionFixtures: ReactVersionFixture[] = [
  { major: 17, reactPackageName: "react-17", reactDOMPackageName: "react-dom-17" },
  { major: 18, reactPackageName: "react-18", reactDOMPackageName: "react-dom-18" },
  { major: 19, reactPackageName: "react", reactDOMPackageName: "react-dom" },
];

const copyPackage = (
  sourcePackageJsonPath: string,
  targetPackageName: string,
  runtimeNodeModules: string,
  copiedPackages: Set<string>,
): void => {
  if (copiedPackages.has(targetPackageName)) return;
  copiedPackages.add(targetPackageName);

  const targetDirectory = join(runtimeNodeModules, ...targetPackageName.split("/"));
  mkdirSync(dirname(targetDirectory), { recursive: true });
  cpSync(dirname(realpathSync(sourcePackageJsonPath)), targetDirectory, {
    dereference: true,
    recursive: true,
  });

  const packageJson = JSON.parse(readFileSync(sourcePackageJsonPath, "utf8"));
  const sourceRequire = createRequire(sourcePackageJsonPath);
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    if (dependencyName === "react" && copiedPackages.has("react")) continue;
    const dependencyPackageJsonPath = sourceRequire.resolve(`${dependencyName}/package.json`);
    copyPackage(dependencyPackageJsonPath, dependencyName, runtimeNodeModules, copiedPackages);
  }
};

const createIsolatedRuntime = (fixture: ReactVersionFixture): IsolatedRuntime => {
  const directory = mkdtempSync(join(tmpdir(), `bippy-react-${fixture.major}-`));
  runtimeDirectories.push(directory);
  const runtimeNodeModules = join(directory, "node_modules");
  mkdirSync(runtimeNodeModules, { recursive: true });
  const copiedPackages = new Set<string>();

  copyPackage(
    packageRequire.resolve(`${fixture.reactPackageName}/package.json`),
    "react",
    runtimeNodeModules,
    copiedPackages,
  );
  copyPackage(
    packageRequire.resolve(`${fixture.reactDOMPackageName}/package.json`),
    "react-dom",
    runtimeNodeModules,
    copiedPackages,
  );

  const bippyDirectory = join(runtimeNodeModules, "bippy");
  mkdirSync(bippyDirectory, { recursive: true });
  cpSync(resolve(packageDirectory, "src"), join(bippyDirectory, "src"), { recursive: true });
  writeFileSync(
    join(bippyDirectory, "package.json"),
    JSON.stringify({ name: "bippy", type: "module" }),
  );

  return {
    bippyEntryUrl: pathToFileURL(join(bippyDirectory, "src/index.ts")).href,
    directory,
    reactDOMClientUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/client.js")).href,
    reactDOMServerUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/server.js")).href,
    reactDOMUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/index.js")).href,
    reactUrl: pathToFileURL(join(runtimeNodeModules, "react/index.js")).href,
  };
};

const runRuntime = (
  fixture: ReactVersionFixture,
  mode: "development" | "production",
): RuntimeResult => {
  const runtime = createIsolatedRuntime(fixture);
  const script = `
    import assert from "node:assert/strict";
    import { Window } from "happy-dom";

    const browserWindow = new Window({ url: "http://localhost" });
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
    globalThis.Node = browserWindow.Node;
    globalThis.HTMLElement = browserWindow.HTMLElement;
    globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
    globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);

    const Bippy = await import(${JSON.stringify(runtime.bippyEntryUrl)});
    globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE = () => {};
    const ReactModule = await import(${JSON.stringify(runtime.reactUrl)});
    const React = ReactModule.default ?? ReactModule;
    const ReactDOMModule = await import(${JSON.stringify(runtime.reactDOMUrl)});
    const ReactDOM = ReactDOMModule.default ?? ReactDOMModule;
    const ReactDOMServerModule = await import(${JSON.stringify(runtime.reactDOMServerUrl)});
    const ReactDOMServer = ReactDOMServerModule.default ?? ReactDOMServerModule;
    const ReactDOMClientModule = ${fixture.major >= 18 ? `await import(${JSON.stringify(runtime.reactDOMClientUrl)})` : "null"};
    const ReactDOMClient = ReactDOMClientModule?.default ?? ReactDOMClientModule;
    const originalBind = Function.prototype.bind;
    const mountedRoots = [];

    const waitFor = async (condition, message) => {
      const deadline = Date.now() + 2_000;
      while (!condition()) {
        if (Date.now() >= deadline) throw new Error(message);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
      }
    };

    const flush = (callback) => {
      if (typeof ReactDOM.flushSync === "function") {
        ReactDOM.flushSync(callback);
      } else {
        callback();
      }
    };

    const mount = (element, container = document.createElement("div")) => {
      document.body.appendChild(container);
      if (${fixture.major} >= 18) {
        const root = ReactDOMClient.createRoot(container);
        flush(() => root.render(element));
        const mountedRoot = {
          container,
          render: (nextElement) => flush(() => root.render(nextElement)),
          unmount: () => flush(() => root.unmount()),
        };
        mountedRoots.push(mountedRoot);
        return mountedRoot;
      }

      flush(() => ReactDOM.render(element, container));
      const mountedRoot = {
        container,
        render: (nextElement) => flush(() => ReactDOM.render(nextElement, container)),
        unmount: () => flush(() => ReactDOM.unmountComponentAtNode(container)),
      };
      mountedRoots.push(mountedRoot);
      return mountedRoot;
    };

    const assertFiber = (fiber, component) => {
      assert.ok(Bippy.isFiber(fiber));
      assert.ok(fiber.type === component || fiber.elementType === component);
    };

    let observedFiber;
    let observedSecondFiber;
    let stateInitializerCalls = 0;
    let updateState;
    let wasBindRestoredDuringRender = true;
    const Probe = ({ revision }) => {
      const [, setState] = React.useState(() => {
        stateInitializerCalls += 1;
        return 0;
      });
      observedFiber = Bippy.useFiber();
      wasBindRestoredDuringRender &&= Function.prototype.bind === originalBind;
      observedSecondFiber = Bippy.useFiber();
      wasBindRestoredDuringRender &&= Function.prototype.bind === originalBind;
      updateState = setState;
      return React.createElement("div", null, revision);
    };
    const probeRoot = mount(React.createElement(Probe, { revision: 1 }));
    const mountedFiber = observedFiber;
    assertFiber(mountedFiber, Probe);
    assert.equal(observedSecondFiber, mountedFiber);

    let previousFiber = mountedFiber;
    for (let revision = 2; revision <= 12; revision += 1) {
      probeRoot.render(React.createElement(Probe, { revision }));
      const propsUpdatedFiber = observedFiber;
      assertFiber(propsUpdatedFiber, Probe);
      assert.equal(observedSecondFiber, propsUpdatedFiber);
      assert.notEqual(propsUpdatedFiber, previousFiber);
      assert.equal(propsUpdatedFiber.alternate, previousFiber);
      assert.equal(propsUpdatedFiber.memoizedProps.revision, revision);
      assert.equal(Bippy.getLatestFiber(previousFiber), propsUpdatedFiber);
      previousFiber = propsUpdatedFiber;
    }

    flush(() => updateState(1));
    const stateUpdatedFiber = observedFiber;
    assertFiber(stateUpdatedFiber, Probe);
    assert.equal(observedSecondFiber, stateUpdatedFiber);
    assert.notEqual(stateUpdatedFiber, previousFiber);
    assert.equal(stateUpdatedFiber.alternate, previousFiber);
    assert.equal(stateUpdatedFiber.memoizedProps.revision, 12);
    assert.equal(stateInitializerCalls, 1);
    assert.equal(wasBindRestoredDuringRender, true);

    const renderPhaseFibers = [];
    const RenderPhaseProbe = () => {
      renderPhaseFibers.push(Bippy.useFiber());
      const [state, setState] = React.useState(0);
      if (state === 0) setState(1);
      return null;
    };
    mount(React.createElement(RenderPhaseProbe));
    assert.equal(renderPhaseFibers.length, 2);
    renderPhaseFibers.forEach((fiber) => assertFiber(fiber, RenderPhaseProbe));

    let forwardFiber;
    let memoFiber;
    const ForwardProbe = React.forwardRef((_props, _ref) => {
      forwardFiber = Bippy.useFiber();
      return null;
    });
    const MemoProbeInner = () => {
      memoFiber = Bippy.useFiber();
      return null;
    };
    const MemoProbe = React.memo(MemoProbeInner);
    mount(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ForwardProbe),
        React.createElement(MemoProbe),
      ),
    );
    assertFiber(forwardFiber, ForwardProbe);
    assert.ok(memoFiber.type === MemoProbeInner || memoFiber.elementType === MemoProbe);
    assert.notEqual(forwardFiber, memoFiber);

    let portalFiber;
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);
    const PortalProbe = () => {
      portalFiber = Bippy.useFiber();
      return ReactDOM.createPortal(React.createElement("span", null, "portal"), portalContainer);
    };
    mount(React.createElement(PortalProbe));
    assertFiber(portalFiber, PortalProbe);

    let suspendedFiber;
    let shouldSuspend = true;
    let resolveSuspense;
    const suspensePromise = new Promise((resolvePromise) => {
      resolveSuspense = resolvePromise;
    });
    const SuspenseProbe = () => {
      suspendedFiber = Bippy.useFiber();
      if (shouldSuspend) throw suspensePromise;
      return React.createElement("div", null, "ready");
    };
    const createSuspenseElement = () =>
      React.createElement(
        React.Suspense,
        { fallback: React.createElement("div", null, "loading") },
        React.createElement(SuspenseProbe),
      );
    const suspenseRoot = mount(createSuspenseElement());
    assertFiber(suspendedFiber, SuspenseProbe);
    assert.equal(suspenseRoot.container.textContent, "loading");
    shouldSuspend = false;
    resolveSuspense();
    suspenseRoot.render(createSuspenseElement());
    await waitFor(
      () => suspenseRoot.container.textContent === "ready",
      "suspended component did not resolve",
    );
    assertFiber(suspendedFiber, SuspenseProbe);

    let thrownFiber;
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        return this.state.error ? null : this.props.children;
      }
    }
    const ThrowingProbe = () => {
      thrownFiber = Bippy.useFiber();
      throw new Error("expected test error");
    };
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      mount(React.createElement(ErrorBoundary, null, React.createElement(ThrowingProbe)));
    } finally {
      console.error = previousConsoleError;
    }
    assertFiber(thrownFiber, ThrowingProbe);

    let firstComponentFiber;
    let remountedFiber;
    const FirstComponent = () => {
      firstComponentFiber = Bippy.useFiber();
      return null;
    };
    const ReplacementComponent = () => {
      remountedFiber = Bippy.useFiber();
      return null;
    };
    const replacementRoot = mount(React.createElement(FirstComponent));
    assertFiber(firstComponentFiber, FirstComponent);
    replacementRoot.render(React.createElement(ReplacementComponent));
    assertFiber(remountedFiber, ReplacementComponent);
    assert.notEqual(remountedFiber, firstComponentFiber);

    const strictModeFibers = [];
    const StrictModeProbe = () => {
      strictModeFibers.push(Bippy.useFiber());
      return null;
    };
    mount(React.createElement(React.StrictMode, null, React.createElement(StrictModeProbe)));
    assert.ok(strictModeFibers.length >= 1);
    strictModeFibers.forEach((fiber) => assertFiber(fiber, StrictModeProbe));

    if (typeof React.startTransition === "function") {
      let transitionFiber;
      let setTransitionState;
      const TransitionProbe = () => {
        transitionFiber = Bippy.useFiber();
        const [, setState] = React.useState(0);
        setTransitionState = setState;
        return null;
      };
      mount(React.createElement(TransitionProbe));
      const fiberBeforeTransition = transitionFiber;
      React.startTransition(() => setTransitionState(1));
      await waitFor(
        () => transitionFiber !== fiberBeforeTransition,
        "transition did not render a new fiber",
      );
      assertFiber(transitionFiber, TransitionProbe);
    }

    let serverFiber = "not-rendered";
    const HydrationProbe = () => {
      const fiber = Bippy.useFiber();
      if (serverFiber === "not-rendered") serverFiber = fiber;
      observedFiber = fiber;
      return React.createElement("div", null, "hydrated");
    };
    const serverErrors = [];
    const previousServerConsoleError = console.error;
    console.error = (...messages) => serverErrors.push(messages.join(" "));
    let serverMarkup;
    try {
      serverMarkup = ReactDOMServer.renderToString(React.createElement(HydrationProbe));
    } finally {
      console.error = previousServerConsoleError;
    }
    assert.equal(serverFiber, undefined);
    assert.equal(serverErrors.some((message) => message.includes("useLayoutEffect")), false);
    const hydrationContainer = document.createElement("div");
    hydrationContainer.innerHTML = serverMarkup;
    document.body.appendChild(hydrationContainer);
    if (${fixture.major} >= 18) {
      const hydrationRoot = ReactDOMClient.hydrateRoot(
        hydrationContainer,
        React.createElement(HydrationProbe),
      );
      await waitFor(() => Bippy.isFiber(observedFiber), "hydration did not capture a fiber");
      mountedRoots.push({
        container: hydrationContainer,
        render: () => {},
        unmount: () => flush(() => hydrationRoot.unmount()),
      });
    } else {
      ReactDOM.hydrate(React.createElement(HydrationProbe), hydrationContainer);
      mountedRoots.push({
        container: hydrationContainer,
        render: () => {},
        unmount: () => ReactDOM.unmountComponentAtNode(hydrationContainer),
      });
    }
    assertFiber(observedFiber, HydrationProbe);

    assert.equal(Function.prototype.bind, originalBind);
    for (const mountedRoot of mountedRoots.reverse()) {
      mountedRoot.unmount();
      mountedRoot.container.remove();
    }
    portalContainer.remove();
    assert.equal(Function.prototype.bind, originalBind);
    console.log(JSON.stringify({ mode: ${JSON.stringify(mode)}, react: React.version }));
    process.exit(0);
  `;

  return runNodeScript(script, { environment: { NODE_ENV: mode }, timeout: 30_000 });
};

afterAll(() => {
  for (const directory of runtimeDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe.each(reactVersionFixtures)("React $major providerless useFiber", (fixture) => {
  it.each(["development", "production"] as const)(
    "handles real-world edge cases in %s",
    (mode) => {
      const result = runRuntime(fixture, mode);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`"react":"${fixture.major}.`);
      expect(result.stdout).toContain(`"mode":"${mode}"`);
    },
    35_000,
  );
});
