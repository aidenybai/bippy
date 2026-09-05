import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { createBrowserBootstrapScript } from "./isolated-react-runtime.js";
import { describeRuntimeFailure, runNodeScript } from "./run-node-script.js";
import { openSourceInjectionTargets } from "./use-fiber-open-source-loader.js";

interface OpenSourceProbeResult {
  mismatches: string[];
  renderCount: number;
}

interface OpenSourceInjectionReport {
  probes: Record<string, OpenSourceProbeResult>;
  wasBindRestored: boolean;
}

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const loaderUrl = pathToFileURL(resolve(testsDirectory, "use-fiber-open-source-loader.ts")).href;
const oracleUrl = pathToFileURL(resolve(testsDirectory, "use-fiber-oracle.ts")).href;
const expectedProbeNames = [
  ...new Set(openSourceInjectionTargets.map(({ probeName }) => probeName)),
];

// Every library hook below gets `useFiber` injected at the top of its own source through a
// Node loader hook, so the fiber must match the component that called the library hook.
const createInjectionScript = (isDevelopment: boolean): string => `
  import { register } from "node:module";
  register(${JSON.stringify(loaderUrl)});
  ${createBrowserBootstrapScript()}
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  const Bippy = await import("../bippy/src/index.ts");
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE = () => {};
  const React = (await import("react")).default;
  const ReactDOM = (await import("react-dom")).default;
  const ReactDOMClient = (await import("react-dom/client")).default;
  const { checkCallingFiber, createFiberRootRegistry, matchByHookState } = await import(${JSON.stringify(oracleUrl)});
  const registry = createFiberRootRegistry();
  const originalBind = Function.prototype.bind;
  const probes = {};
  globalThis.__useOpenSourceFiberProbe = (probeName) => {
    const fiber = Bippy.useFiber();
    const marker = React.useRef(null);
    const probe = (probes[probeName] ??= { mismatches: [], renderCount: 0 });
    probe.renderCount += 1;
    try {
      const mismatch = checkCallingFiber(registry, matchByHookState(marker), fiber, ${isDevelopment});
      if (mismatch) probe.mismatches.push(JSON.stringify(mismatch));
    } catch (error) {
      probe.mismatches.push("oracle error " + error.message);
    }
  };
  const settle = async () => {
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
  };
  const drivers = [];

  const { create } = await import("zustand");
  const useBearStore = create((set) => ({ bears: 0, increase: () => set((state) => ({ bears: state.bears + 1 })) }));
  drivers.push({
    element: () => React.createElement(() => React.createElement("i", null, useBearStore((state) => state.bears))),
    update: () => ReactDOM.flushSync(() => useBearStore.getState().increase()),
  });

  const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
  const queryClient = new QueryClient();
  let queryCounter = 0;
  const QueryComponent = () => {
    const query = useQuery({ queryKey: ["counter"], queryFn: async () => (queryCounter += 1) });
    return React.createElement("i", null, String(query.data));
  };
  drivers.push({
    element: () => React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(QueryComponent)),
    update: async () => {
      await queryClient.refetchQueries();
      await settle();
    },
  });

  const { useForm } = await import("react-hook-form");
  let setFormValue;
  let formRevision = 0;
  const FormComponent = () => {
    const { watch, setValue } = useForm({ defaultValues: { name: "" } });
    setFormValue = setValue;
    return React.createElement("i", null, watch("name"));
  };
  drivers.push({
    element: () => React.createElement(FormComponent),
    update: () => ReactDOM.flushSync(() => setFormValue("name", "value-" + (formRevision += 1))),
  });

  const { Provider: ReduxProvider, useSelector } = await import("react-redux");
  const reduxListeners = new Set();
  let reduxState = { count: 0 };
  const reduxStore = {
    dispatch: (action) => {
      if (action.type === "increment") reduxState = { count: reduxState.count + 1 };
      reduxListeners.forEach((listener) => listener());
      return action;
    },
    getState: () => reduxState,
    subscribe: (listener) => {
      reduxListeners.add(listener);
      return () => reduxListeners.delete(listener);
    },
  };
  const ReduxComponent = () => React.createElement("i", null, useSelector((state) => state.count));
  drivers.push({
    element: () => React.createElement(ReduxProvider, { store: reduxStore }, React.createElement(ReduxComponent)),
    update: () => ReactDOM.flushSync(() => reduxStore.dispatch({ type: "increment" })),
  });

  const { atom, createStore: createJotaiStore, Provider: JotaiProvider, useAtomValue } = await import("jotai");
  const countAtom = atom(0);
  const jotaiStore = createJotaiStore();
  const JotaiComponent = () => React.createElement("i", null, useAtomValue(countAtom));
  drivers.push({
    element: () => React.createElement(JotaiProvider, { store: jotaiStore }, React.createElement(JotaiComponent)),
    update: () => ReactDOM.flushSync(() => jotaiStore.set(countAtom, jotaiStore.get(countAtom) + 1)),
  });

  const { useVirtualizer } = await import("@tanstack/react-virtual");
  const VirtualComponent = ({ count }) => {
    const parentRef = React.useRef(null);
    const virtualizer = useVirtualizer({ count, estimateSize: () => 20, getScrollElement: () => parentRef.current });
    return React.createElement("div", { ref: parentRef }, virtualizer.getVirtualItems().length);
  };
  drivers.push({ element: (revision) => React.createElement(VirtualComponent, { count: 10 + revision }) });

  const { createMemoryRouter, RouterProvider, useLocation, useNavigate } = await import("react-router");
  let navigateRef;
  let routeRevision = 0;
  const RoutePage = () => {
    navigateRef = useNavigate();
    return React.createElement("i", null, useLocation().pathname);
  };
  const router = createMemoryRouter([{ element: React.createElement(RoutePage), path: "*" }]);
  drivers.push({
    element: () => React.createElement(RouterProvider, { router }),
    update: async () => {
      await router.navigate("/route-" + (routeRevision += 1));
      await settle();
    },
  });

  const { animated, useSpring } = await import("@react-spring/web");
  const SpringComponent = ({ revision }) => {
    const [styles] = useSpring(() => ({ x: revision }), [revision]);
    return React.createElement(animated.div, { style: styles });
  };
  drivers.push({ element: (revision) => React.createElement(SpringComponent, { revision }) });

  const { FloatingPortal, useFloating } = await import("@floating-ui/react");
  const FloatingComponent = ({ revision }) => {
    const { floatingStyles, refs } = useFloating({ open: true });
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { ref: refs.setReference }, revision),
      React.createElement(FloatingPortal, null, React.createElement("div", { ref: refs.setFloating, style: floatingStyles })),
    );
  };
  drivers.push({ element: (revision) => React.createElement(FloatingComponent, { revision }) });

  const { useFormik } = await import("formik/dist/formik.esm.js");
  let setFormikField;
  let formikRevision = 0;
  const FormikComponent = () => {
    const formik = useFormik({ initialValues: { name: "" }, onSubmit: () => {} });
    setFormikField = formik.setFieldValue;
    return React.createElement("i", null, formik.values.name);
  };
  drivers.push({
    element: () => React.createElement(FormikComponent),
    update: () => ReactDOM.flushSync(() => setFormikField("name", "value-" + (formikRevision += 1))),
  });

  for (const driver of drivers) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => root.render(driver.element(0)));
    await settle();
    for (let revision = 1; revision <= 3; revision += 1) {
      ReactDOM.flushSync(() => root.render(driver.element(revision)));
      if (driver.update) await driver.update();
    }
    ReactDOM.flushSync(() => root.unmount());
    container.remove();
  }
  console.log("__REPORT__" + JSON.stringify({ probes, wasBindRestored: Function.prototype.bind === originalBind }));
  process.exit(0);
`;

const runInjection = (isDevelopment: boolean): OpenSourceInjectionReport => {
  const result = runNodeScript(createInjectionScript(isDevelopment), {
    environment: { NODE_ENV: isDevelopment ? "development" : "production" },
    timeout: 120_000,
  });
  const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
  if (result.status !== 0 || !reportLine) {
    throw new Error(describeRuntimeFailure("injection runtime failed", result));
  }
  return JSON.parse(reportLine.slice("__REPORT__".length));
};

describe("useFiber injected into open-source library hooks", () => {
  it.each(["development", "production"] as const)(
    "matches the calling fiber inside every injected library hook in %s",
    (mode) => {
      const report = runInjection(mode === "development");
      expect(report.wasBindRestored).toBe(true);
      expect(Object.keys(report.probes).sort()).toEqual([...expectedProbeNames].sort());
      for (const probeName of expectedProbeNames) {
        expect(report.probes[probeName].renderCount, probeName).toBeGreaterThan(1);
        expect(report.probes[probeName].mismatches, probeName).toEqual([]);
      }
    },
    130_000,
  );
});
