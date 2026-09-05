import { runInNewContext } from "node:vm";
import { setFlagsFromString } from "node:v8";
import type * as ReactNamespace from "react";
import type { Fiber } from "../../../bippy/src/react-internals/index.js";
import {
  checkCallingFiber,
  createFiberRootRegistry,
  type FiberRootRegistry,
  getCommittedFiber,
  matchByProps,
} from "./use-fiber-oracle.js";

type ReactModule = typeof ReactNamespace;
type ReactElement = ReactNamespace.ReactElement;
type ReactNode = ReactNamespace.ReactNode;

export interface LegacyReactDOMModule {
  createPortal: (children: ReactNode, container: Element) => ReactElement;
  flushSync: <T>(callback: () => T) => T;
  hydrate?: (element: ReactElement, container: Element) => void;
  render?: (element: ReactElement, container: Element) => void;
  unmountComponentAtNode?: (container: Element) => boolean;
}

export interface ReactDOMRootLike {
  render: (element: ReactElement) => void;
  unmount: () => void;
}

export interface ReactDOMClientModule {
  createRoot: (container: Element) => ReactDOMRootLike;
  hydrateRoot: (
    container: Element,
    element: ReactElement,
    options?: { onRecoverableError?: (error: unknown) => void },
  ) => ReactDOMRootLike;
}

export interface ReactDOMServerModule {
  renderToString: (element: ReactElement) => string;
}

export interface UseFiberAttackContext {
  React: ReactModule;
  ReactDOM: LegacyReactDOMModule;
  ReactDOMClient: ReactDOMClientModule | null;
  ReactDOMServer: ReactDOMServerModule;
  isDevelopment: boolean;
  useFiber: () => Fiber | undefined;
}

export interface UseFiberAttackFailure {
  message: string;
  scenario: string;
}

export interface UseFiberAttackReport {
  failures: UseFiberAttackFailure[];
  scenarioNames: string[];
}

interface MountedRoot {
  container: HTMLElement;
  render: (element: ReactElement) => void;
  unmount: () => void;
}

interface ProbeProps {
  afterFiber?: () => void;
  children?: ReactNode;
  revision?: number;
}

interface Probe {
  Component: ReactNamespace.ComponentType<ProbeProps>;
  getRenderCount: () => number;
  update: () => void;
}

interface ErrorBoundaryProps {
  children?: ReactNode;
  resetKey?: number;
}

interface ErrorBoundaryState {
  error: unknown;
}

interface SuspenseGate {
  promise: Promise<void>;
  resolve: () => void;
  shouldSuspend: boolean;
}

interface TaggedEffect {
  next: unknown;
  tag: number;
}

interface ActivityProps {
  children?: ReactNode;
  mode: "hidden" | "visible";
}

type RootMode = "legacy" | "concurrent";

const isActivityComponent = (
  value: unknown,
): value is ReactNamespace.ComponentType<ActivityProps> =>
  typeof value === "object" && value !== null && "$$typeof" in value;

const findFiberByType = (fiber: Fiber | null, type: unknown): Fiber | undefined => {
  for (let current = fiber; current; current = current.sibling) {
    if (current.type === type) return current;
    const match = findFiberByType(current.child, type);
    if (match) return match;
  }
  return undefined;
};

const HookHasEffect = 0b0001;

const waitFor = async (condition: () => boolean, message: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
  }
};

const nextMacrotask = (): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

const createSuspenseGate = (): SuspenseGate => {
  let resolvePromise = (): void => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise, shouldSuspend: false };
};

const isTaggedEffect = (value: unknown): value is TaggedEffect =>
  typeof value === "object" && value !== null && "tag" in value && "next" in value;

const countEffectsWithFlag = (fiber: Fiber, flag: number): number => {
  const lastEffect = fiber.updateQueue?.lastEffect;
  if (!isTaggedEffect(lastEffect)) return 0;
  let count = 0;
  let effect = lastEffect;
  do {
    if (!isTaggedEffect(effect.next)) break;
    effect = effect.next;
    if (effect.tag & flag) count += 1;
  } while (effect !== lastEffect);
  return count;
};

export const runUseFiberAttackScenarios = async (
  context: UseFiberAttackContext,
): Promise<UseFiberAttackReport> => {
  const { React, ReactDOM, ReactDOMClient, ReactDOMServer, isDevelopment, useFiber } = context;
  const originalBind = Function.prototype.bind;
  const registry: FiberRootRegistry = createFiberRootRegistry();
  const failures: UseFiberAttackFailure[] = [];
  const scenarioNames: string[] = [];
  const mountedRoots: MountedRoot[] = [];
  const supportsLegacyRoot = typeof ReactDOM.render === "function";
  const supportsConcurrentRoot = ReactDOMClient !== null;
  let currentScenario = "";
  let currentStep = "";
  let isServerRendering = false;

  const fail = (message: string): void => {
    failures.push({
      message: `${currentStep ? `[${currentStep}] ` : ""}${message}`,
      scenario: currentScenario,
    });
  };

  const observe = (component: unknown, props: object, fiber: unknown): void => {
    try {
      const mismatch = checkCallingFiber(
        registry,
        matchByProps(component, props),
        fiber,
        isDevelopment,
      );
      if (mismatch) fail(`useFiber mismatch ${JSON.stringify(mismatch)}`);
    } catch (error) {
      fail(`oracle error ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const createProbe = (): Probe => {
    let renderCount = 0;
    let setRevision: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
    const ProbeComponent = (props: ProbeProps): ReactNode => {
      const fiber = useFiber();
      [, setRevision] = React.useState(0);
      if (isServerRendering) {
        if (fiber !== undefined) fail("server render observed a fiber");
        return props.children ?? null;
      }
      renderCount += 1;
      observe(ProbeComponent, props, fiber);
      props.afterFiber?.();
      return props.children ?? null;
    };
    return {
      Component: ProbeComponent,
      getRenderCount: () => renderCount,
      update: () => ReactDOM.flushSync(() => setRevision((revision) => revision + 1)),
    };
  };

  const mount = (element: ReactElement, mode: RootMode): MountedRoot => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);
    let mountedRoot: MountedRoot;
    if (mode === "concurrent") {
      if (!ReactDOMClient) throw new Error("concurrent roots are unavailable");
      const root = ReactDOMClient.createRoot(container);
      ReactDOM.flushSync(() => root.render(element));
      mountedRoot = {
        container,
        render: (nextElement) => ReactDOM.flushSync(() => root.render(nextElement)),
        unmount: () => ReactDOM.flushSync(() => root.unmount()),
      };
    } else {
      const { render, unmountComponentAtNode } = ReactDOM;
      if (!render || !unmountComponentAtNode) throw new Error("legacy roots are unavailable");
      render(element, container);
      mountedRoot = {
        container,
        render: (nextElement) => render(nextElement, container),
        unmount: () => {
          unmountComponentAtNode(container);
        },
      };
    }
    mountedRoots.push(mountedRoot);
    return mountedRoot;
  };

  const unmountAll = (): void => {
    for (const mountedRoot of mountedRoots.splice(0).reverse()) {
      mountedRoot.unmount();
      mountedRoot.container.remove();
    }
    registry.clear();
  };

  const rootModes = (): RootMode[] => [
    ...(supportsLegacyRoot ? (["legacy"] as const) : []),
    ...(supportsConcurrentRoot ? (["concurrent"] as const) : []),
  ];

  const withConsoleErrorCapture = async (
    callback: () => Promise<void> | void,
  ): Promise<string[]> => {
    const messages: string[] = [];
    const previousConsoleError = console.error;
    console.error = (...parts: unknown[]) => {
      messages.push(
        parts.map((part) => (part instanceof Error ? part.message : String(part))).join(" "),
      );
    };
    try {
      await callback();
    } finally {
      console.error = previousConsoleError;
    }
    return messages;
  };

  class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
      return { error };
    }

    override componentDidUpdate(previousProps: ErrorBoundaryProps): void {
      if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
        this.setState({ error: null });
      }
    }

    override render(): ReactNode {
      return this.state.error ? null : this.props.children;
    }
  }

  const scenarios: Array<[string, () => Promise<void> | void]> = [];
  const scenario = (name: string, run: () => Promise<void> | void): void => {
    scenarios.push([name, run]);
  };

  for (const mode of rootModes()) {
    scenario(`${mode}: memo child bails out on parent updates`, () => {
      const probe = createProbe();
      const MemoProbe = React.memo(probe.Component);
      let setParentRevision: ReactNamespace.Dispatch<
        ReactNamespace.SetStateAction<number>
      > = () => {};
      const Parent = () => {
        const [revision, setRevision] = React.useState(0);
        setParentRevision = setRevision;
        return React.createElement(
          "div",
          { "data-revision": revision },
          React.createElement(MemoProbe),
        );
      };
      mount(React.createElement(Parent), mode);
      for (let round = 1; round <= 4; round += 1) {
        currentStep = `round ${round} child self-update`;
        probe.update();
        probe.update();
        currentStep = `round ${round} parent update (child bails out)`;
        const renderCountBeforeBailout = probe.getRenderCount();
        for (let bailout = 0; bailout < round; bailout += 1) {
          ReactDOM.flushSync(() => setParentRevision((revision) => revision + 1));
        }
        if (probe.getRenderCount() !== renderCountBeforeBailout) fail("memo child re-rendered");
        currentStep = `round ${round} child update after bailout`;
        probe.update();
      }
    });

    scenario(`${mode}: children pass-through bails out on parent updates`, () => {
      const probe = createProbe();
      const probeElement = React.createElement(probe.Component);
      let setParentRevision: ReactNamespace.Dispatch<
        ReactNamespace.SetStateAction<number>
      > = () => {};
      const Parent = ({ children }: { children: ReactNode }) => {
        const [revision, setRevision] = React.useState(0);
        setParentRevision = setRevision;
        return React.createElement("section", { "data-revision": revision }, children);
      };
      mount(React.createElement(Parent, null, probeElement), mode);
      currentStep = "parent update";
      ReactDOM.flushSync(() => setParentRevision(1));
      currentStep = "child update after bailout";
      probe.update();
      currentStep = "child update again";
      probe.update();
    });

    scenario(`${mode}: context consumer under memo wrapper`, () => {
      const RevisionContext = React.createContext(0);
      const probe = createProbe();
      const Consumer = () => {
        const revision = React.useContext(RevisionContext);
        return React.createElement(probe.Component, { revision });
      };
      const MemoWrapper = React.memo(() => React.createElement(Consumer));
      let setContextRevision: ReactNamespace.Dispatch<
        ReactNamespace.SetStateAction<number>
      > = () => {};
      const Provider = () => {
        const [revision, setRevision] = React.useState(0);
        setContextRevision = setRevision;
        return React.createElement(
          RevisionContext.Provider,
          { value: revision },
          React.createElement(MemoWrapper),
        );
      };
      mount(React.createElement(Provider), mode);
      for (let revision = 1; revision <= 3; revision += 1) {
        currentStep = `context revision ${revision}`;
        ReactDOM.flushSync(() => setContextRevision(revision));
        currentStep = `probe self-update after context revision ${revision}`;
        probe.update();
      }
    });

    scenario(`${mode}: suspends after useFiber on update then resolves`, async () => {
      const probe = createProbe();
      const gate = createSuspenseGate();
      const suspendAfterFiber = () => {
        if (gate.shouldSuspend) throw gate.promise;
      };
      const Suspender = (props: ProbeProps) =>
        React.createElement(probe.Component, { ...props, afterFiber: suspendAfterFiber });
      let setRevision: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
      const Harness = () => {
        const [revision, setState] = React.useState(0);
        setRevision = setState;
        return React.createElement(
          React.Suspense,
          { fallback: React.createElement("span", null, "loading") },
          React.createElement(Suspender, { revision }),
        );
      };
      const mountedRoot = mount(React.createElement(Harness), mode);
      currentStep = "update before suspending";
      ReactDOM.flushSync(() => setRevision(1));
      currentStep = "suspend on update";
      gate.shouldSuspend = true;
      ReactDOM.flushSync(() => setRevision(2));
      await waitFor(() => mountedRoot.container.textContent === "loading", "fallback not shown");
      currentStep = "resolve suspension";
      gate.shouldSuspend = false;
      gate.resolve();
      await waitFor(() => mountedRoot.container.textContent === "", "suspense did not resolve");
      currentStep = "probe self-update after retry";
      probe.update();
      currentStep = "parent update after retry";
      ReactDOM.flushSync(() => setRevision(3));
      currentStep = "probe self-update after parent update";
      probe.update();
    });

    scenario(`${mode}: throws after useFiber on update then recovers`, async () => {
      const probe = createProbe();
      let shouldThrow = false;
      const throwAfterFiber = () => {
        if (shouldThrow) throw new Error("expected attack error");
      };
      const Thrower = (props: ProbeProps) =>
        React.createElement(probe.Component, { ...props, afterFiber: throwAfterFiber });
      let setResetKey: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
      const Harness = () => {
        const [resetKey, setState] = React.useState(0);
        setResetKey = setState;
        return React.createElement(
          ErrorBoundary,
          { resetKey },
          React.createElement(Thrower, { revision: resetKey }),
        );
      };
      mount(React.createElement(Harness), mode);
      currentStep = "update before throwing";
      probe.update();
      currentStep = "throw on update";
      shouldThrow = true;
      await withConsoleErrorCapture(() => {
        probe.update();
      });
      currentStep = "recover";
      shouldThrow = false;
      ReactDOM.flushSync(() => setResetKey(1));
      currentStep = "probe self-update after recovery";
      probe.update();
      probe.update();
    });

    scenario(`${mode}: render-phase updates on mount and update`, () => {
      const probe = createProbe();
      let setExternalRevision: ReactNamespace.Dispatch<
        ReactNamespace.SetStateAction<number>
      > = () => {};
      const RenderPhaseProbe = (props: ProbeProps) => {
        const fiber = useFiber();
        observe(RenderPhaseProbe, props, fiber);
        const [passes, setPasses] = React.useState(0);
        const [externalRevision, setRevision] = React.useState(0);
        setExternalRevision = setRevision;
        if (passes < 2) setPasses(passes + 1);
        return React.createElement(probe.Component, { revision: passes + externalRevision });
      };
      mount(React.createElement(RenderPhaseProbe), mode);
      currentStep = "external update triggering render-phase passes";
      ReactDOM.flushSync(() => setExternalRevision(1));
      currentStep = "child update";
      probe.update();
    });

    scenario(`${mode}: strict mode`, () => {
      const probe = createProbe();
      const Parent = () =>
        React.createElement(React.StrictMode, null, React.createElement(probe.Component));
      mount(React.createElement(Parent), mode);
      currentStep = "probe update under strict mode";
      probe.update();
      probe.update();
    });

    scenario(`${mode}: portals, forwardRef, memo with compare, lazy`, async () => {
      const portalProbe = createProbe();
      const forwardProbe = createProbe();
      const comparedProbe = createProbe();
      const lazyProbe = createProbe();
      const portalContainer = document.createElement("div");
      document.body.appendChild(portalContainer);
      const PortalHost = () =>
        ReactDOM.createPortal(React.createElement(portalProbe.Component), portalContainer);
      const ForwardProbe = React.forwardRef<HTMLDivElement, ProbeProps>((props, _ref) =>
        React.createElement(forwardProbe.Component, props),
      );
      const ComparedProbe = React.memo(
        (props: ProbeProps) => React.createElement(comparedProbe.Component, props),
        () => false,
      );
      const LazyProbe = React.lazy(() =>
        Promise.resolve({
          default: (props: ProbeProps) => React.createElement(lazyProbe.Component, props),
        }),
      );
      let setRevision: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
      const Harness = () => {
        const [revision, setState] = React.useState(0);
        setRevision = setState;
        return React.createElement(
          React.Suspense,
          { fallback: null },
          React.createElement(PortalHost),
          React.createElement(ForwardProbe, { revision }),
          React.createElement(ComparedProbe, { revision }),
          React.createElement(LazyProbe, { revision }),
        );
      };
      mount(React.createElement(Harness), mode);
      await waitFor(() => lazyProbe.getRenderCount() > 0, "lazy probe did not render");
      for (let revision = 1; revision <= 3; revision += 1) {
        currentStep = `revision ${revision}`;
        ReactDOM.flushSync(() => setRevision(revision));
        portalProbe.update();
        forwardProbe.update();
        comparedProbe.update();
        lazyProbe.update();
      }
      portalContainer.remove();
    });

    scenario(`${mode}: nested custom hooks and repeated consumers`, () => {
      const useNestedFiber = (): Array<Fiber | undefined> => {
        const useInner = () => useFiber();
        const first = useInner();
        React.useMemo(() => first, [first]);
        const second = useFiber();
        return [first, second];
      };
      const NestedProbe = (props: ProbeProps) => {
        const [first, second] = useNestedFiber();
        const third = useFiber();
        observe(NestedProbe, props, first);
        if (first !== second || second !== third) fail("repeated useFiber calls disagree");
        const [, setRevision] = React.useState(0);
        nestedUpdate = () => ReactDOM.flushSync(() => setRevision((revision) => revision + 1));
        return null;
      };
      let nestedUpdate = (): void => {};
      mount(React.createElement(NestedProbe), mode);
      currentStep = "update";
      nestedUpdate();
      nestedUpdate();
    });

    scenario(`${mode}: remount by key change and root churn`, () => {
      const probe = createProbe();
      let setGeneration: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
      const Harness = () => {
        const [generation, setState] = React.useState(0);
        setGeneration = setState;
        return React.createElement(probe.Component, { key: generation, revision: generation });
      };
      const mountedRoot = mount(React.createElement(Harness), mode);
      for (let generation = 1; generation <= 3; generation += 1) {
        currentStep = `generation ${generation}`;
        ReactDOM.flushSync(() => setGeneration(generation));
        probe.update();
      }
      currentStep = "root churn";
      for (let churn = 0; churn < 5; churn += 1) {
        const churnProbe = createProbe();
        const churnRoot = mount(React.createElement(churnProbe.Component), mode);
        churnProbe.update();
        churnRoot.unmount();
        mountedRoots.splice(mountedRoots.indexOf(churnRoot), 1);
        mount(React.createElement(churnProbe.Component), mode);
        churnProbe.update();
      }
      mountedRoot.render(React.createElement(Harness));
      probe.update();
    });

    scenario(`${mode}: no passive effect scheduled on re-render`, () => {
      const probe = createProbe();
      const Harness = () => React.createElement(probe.Component);
      mount(React.createElement(Harness), mode);
      currentStep = "update";
      probe.update();
      const probeFiber = registry
        .listRoots()
        .map((root) => findFiberByType(root.current, probe.Component))
        .find((fiber) => fiber !== undefined);
      if (!probeFiber) {
        fail("probe fiber not found");
        return;
      }
      const scheduledEffects = countEffectsWithFlag(probeFiber, HookHasEffect);
      if (scheduledEffects !== 0) {
        fail(`useFiber scheduled ${scheduledEffects} passive effect(s) on re-render`);
      }
    });
  }

  if (supportsConcurrentRoot) {
    scenario("concurrent: transition interrupted by a sync update", async () => {
      const probe = createProbe();
      let setTransitionRevision: ReactNamespace.Dispatch<
        ReactNamespace.SetStateAction<number>
      > = () => {};
      let setSyncRevision: ReactNamespace.Dispatch<
        ReactNamespace.SetStateAction<number>
      > = () => {};
      const Harness = () => {
        const [transitionRevision, setTransitionState] = React.useState(0);
        const [syncRevision, setSyncState] = React.useState(0);
        setTransitionRevision = setTransitionState;
        setSyncRevision = setSyncState;
        const children: ReactElement[] = [];
        for (let index = 0; index < 20; index += 1) {
          children.push(
            React.createElement(probe.Component, {
              key: index,
              revision: transitionRevision * 100 + syncRevision,
            }),
          );
        }
        return React.createElement("div", null, `${transitionRevision}-${syncRevision}`, children);
      };
      const mountedRoot = mount(React.createElement(Harness), "concurrent");
      for (let round = 1; round <= 5; round += 1) {
        currentStep = `round ${round} start transition`;
        const renderCountBefore = probe.getRenderCount();
        React.startTransition(() => setTransitionRevision(round));
        await waitFor(
          () => probe.getRenderCount() > renderCountBefore,
          "transition never rendered",
        );
        currentStep = `round ${round} interrupting sync update`;
        ReactDOM.flushSync(() => setSyncRevision(round));
        await waitFor(
          () => mountedRoot.container.textContent === `${round}-${round}`,
          "transition did not settle",
        );
      }
    });

    scenario("concurrent: deferred value", async () => {
      const probe = createProbe();
      let setRevision: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
      const Harness = () => {
        const [revision, setState] = React.useState(0);
        setRevision = setState;
        const deferredRevision = React.useDeferredValue(revision);
        return React.createElement(
          "div",
          null,
          String(deferredRevision),
          React.createElement(probe.Component, { revision: deferredRevision }),
        );
      };
      const mountedRoot = mount(React.createElement(Harness), "concurrent");
      for (let revision = 1; revision <= 3; revision += 1) {
        currentStep = `revision ${revision}`;
        ReactDOM.flushSync(() => setRevision(revision));
        await waitFor(
          () => mountedRoot.container.textContent === String(revision),
          "deferred render did not happen",
        );
      }
    });

    scenario("concurrent: two roots interleaving transitions", async () => {
      const setters = new Map<
        Probe,
        ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>>
      >();
      const createHarness = (probe: Probe) => () => {
        const [revision, setRevision] = React.useState(0);
        setters.set(probe, setRevision);
        return React.createElement(
          "div",
          null,
          String(revision),
          React.createElement(probe.Component, { revision }),
        );
      };
      const probes = [createProbe(), createProbe()];
      const roots = probes.map((probe) =>
        mount(React.createElement(createHarness(probe)), "concurrent"),
      );
      for (let revision = 1; revision <= 5; revision += 1) {
        currentStep = `revision ${revision}`;
        for (const probe of probes) {
          React.startTransition(() => setters.get(probe)?.(revision));
        }
        probes[0].update();
        await waitFor(
          () => roots.every((root) => root.container.textContent === String(revision)),
          "roots did not settle",
        );
      }
    });

    const use: unknown = Reflect.get(React, "use");
    if (typeof use === "function") {
      scenario("concurrent: use(promise) suspends on update", async () => {
        const probe = createProbe();
        let pendingPromise: Promise<number> | null = null;
        let resolvedValue = 0;
        const Harness = (props: ProbeProps) => {
          const value: number = pendingPromise
            ? Reflect.apply(use, React, [pendingPromise])
            : resolvedValue;
          return React.createElement(probe.Component, { revision: value + (props.revision ?? 0) });
        };
        let setRevision: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<number>> = () => {};
        const Root = () => {
          const [revision, setState] = React.useState(0);
          setRevision = setState;
          return React.createElement(
            React.Suspense,
            { fallback: null },
            React.createElement(Harness, { revision }),
          );
        };
        mount(React.createElement(Root), "concurrent");
        for (let round = 1; round <= 3; round += 1) {
          currentStep = `round ${round}`;
          let resolvePending = (_value: number): void => {};
          pendingPromise = new Promise<number>((resolve) => {
            resolvePending = resolve;
          });
          ReactDOM.flushSync(() => setRevision(round));
          resolvedValue = round * 10;
          resolvePending(resolvedValue);
          await pendingPromise;
          pendingPromise = null;
          await waitFor(() => probe.getRenderCount() >= round + 1, "use() did not resume");
          probe.update();
        }
      });
    }

    const Activity: unknown = Reflect.get(React, "Activity");
    if (isActivityComponent(Activity)) {
      scenario("concurrent: Activity hidden and visible toggles", async () => {
        const probe = createProbe();
        let setHidden: ReactNamespace.Dispatch<ReactNamespace.SetStateAction<boolean>> = () => {};
        const Harness = () => {
          const [isHidden, setState] = React.useState(false);
          setHidden = setState;
          return React.createElement(
            Activity,
            { mode: isHidden ? "hidden" : "visible" },
            React.createElement(probe.Component, { revision: Number(isHidden) }),
          );
        };
        mount(React.createElement(Harness), "concurrent");
        for (let round = 1; round <= 3; round += 1) {
          currentStep = `round ${round} hide`;
          ReactDOM.flushSync(() => setHidden(true));
          await nextMacrotask();
          await nextMacrotask();
          probe.update();
          currentStep = `round ${round} show`;
          ReactDOM.flushSync(() => setHidden(false));
          await nextMacrotask();
          probe.update();
        }
      });
    }
  }

  scenario("hydration with strict mode and later updates", async () => {
    const probe = createProbe();
    const Harness = () =>
      React.createElement(
        React.StrictMode,
        null,
        React.createElement("div", null, React.createElement(probe.Component)),
      );
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);
    currentStep = "server render";
    isServerRendering = true;
    const serverMessages = await withConsoleErrorCapture(() => {
      container.innerHTML = ReactDOMServer.renderToString(React.createElement(Harness));
    });
    isServerRendering = false;
    if (serverMessages.length > 0) fail(`server render logged ${JSON.stringify(serverMessages)}`);
    currentStep = "hydrate";
    const hydrationMessages = await withConsoleErrorCapture(async () => {
      if (ReactDOMClient) {
        const root = ReactDOMClient.hydrateRoot(container, React.createElement(Harness));
        mountedRoots.push({
          container,
          render: (element) => ReactDOM.flushSync(() => root.render(element)),
          unmount: () => ReactDOM.flushSync(() => root.unmount()),
        });
      } else {
        const { hydrate, unmountComponentAtNode } = ReactDOM;
        if (!hydrate || !unmountComponentAtNode) throw new Error("hydrate unavailable");
        hydrate(React.createElement(Harness), container);
        mountedRoots.push({
          container,
          render: () => {},
          unmount: () => {
            unmountComponentAtNode(container);
          },
        });
      }
      await waitFor(() => probe.getRenderCount() > 0, "hydration did not render");
    });
    if (hydrationMessages.length > 0) fail(`hydration logged ${JSON.stringify(hydrationMessages)}`);
    currentStep = "update after hydration";
    probe.update();
    probe.update();
  });

  if (ReactDOMClient) {
    scenario("hydration mismatch falls back to client rendering", async () => {
      const probe = createProbe();
      const Harness = () => React.createElement("div", null, React.createElement(probe.Component));
      const container = document.createElement("div");
      document.body.appendChild(container);
      registry.addContainer(container);
      container.innerHTML = "<span>mismatch</span>";
      currentStep = "hydrate mismatched markup";
      await withConsoleErrorCapture(async () => {
        const root = ReactDOMClient.hydrateRoot(container, React.createElement(Harness), {
          onRecoverableError: () => {},
        });
        mountedRoots.push({
          container,
          render: (element) => ReactDOM.flushSync(() => root.render(element)),
          unmount: () => ReactDOM.flushSync(() => root.unmount()),
        });
        await waitFor(
          () => container.querySelector("span") === null,
          "client render did not replace markup",
        );
      });
      currentStep = "update after client fallback";
      probe.update();
      probe.update();
    });
  }

  scenario("fibers are released after unmount", async () => {
    setFlagsFromString("--expose-gc");
    const collectGarbage: () => void = runInNewContext("gc");
    const probe = createProbe();
    const controlFibers: Array<WeakRef<Fiber>> = [];
    const probeFibers: Array<WeakRef<Fiber>> = [];
    const ControlComponent = (props: ProbeProps) => {
      const [, setRevision] = React.useState(0);
      controlUpdate = () => ReactDOM.flushSync(() => setRevision((revision) => revision + 1));
      const fiber = getCommittedFiber(registry, ControlComponent, props);
      if (fiber) controlFibers.push(new WeakRef(fiber));
      return null;
    };
    let controlUpdate = (): void => {};
    const ProbeWrapper = (props: ProbeProps) => {
      const fiber = useFiber();
      if (fiber) probeFibers.push(new WeakRef(fiber));
      return React.createElement(probe.Component, props);
    };
    const mode = supportsConcurrentRoot ? "concurrent" : "legacy";
    const mountedRoot = mount(
      React.createElement(
        "div",
        null,
        React.createElement(ProbeWrapper),
        React.createElement(ControlComponent),
      ),
      mode,
    );
    for (let round = 0; round < 3; round += 1) {
      probe.update();
      controlUpdate();
    }
    mountedRoot.unmount();
    mountedRoots.splice(mountedRoots.indexOf(mountedRoot), 1);
    mountedRoot.container.remove();
    registry.clear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await nextMacrotask();
      collectGarbage();
    }
    const retainedControl = controlFibers.filter((weakRef) => weakRef.deref() !== undefined).length;
    const retainedProbe = probeFibers.filter((weakRef) => weakRef.deref() !== undefined).length;
    if (retainedControl === 0 && retainedProbe > 0) {
      fail(`useFiber retained ${retainedProbe} fiber(s) after unmount`);
    }
  });

  for (const [name, run] of scenarios) {
    currentScenario = name;
    currentStep = "";
    scenarioNames.push(name);
    try {
      await run();
    } catch (error) {
      fail(`threw ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
    try {
      unmountAll();
    } catch (error) {
      fail(`unmount threw ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Function.prototype.bind !== originalBind) {
      fail("Function.prototype.bind was not restored");
      Function.prototype.bind = originalBind;
    }
  }

  return { failures, scenarioNames };
};
