import type { Fiber } from "bippy";
import type * as React from "react";

interface UseFiberScenariosOptions {
  createPortal: (
    children: React.ReactNode,
    container: Element | DocumentFragment,
  ) => React.ReactPortal;
  react: typeof React;
  useFiber: () => Fiber | undefined;
  useReferenceFiber: () => Fiber | undefined;
}

interface RevisionProps {
  revision: number;
}

interface RemountProbeProps {
  generation: number;
}

interface ScenarioErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ScenarioErrorBoundaryState {
  hasError: boolean;
}

interface LazyScenarioModule {
  default: React.ComponentType;
}

const isMatchingReferenceFiber = (
  fiber: Fiber | undefined,
  referenceFiber: Fiber | undefined,
): boolean => {
  if (typeof window === "undefined") {
    return fiber === undefined && referenceFiber === undefined;
  }
  return fiber !== undefined && (fiber === referenceFiber || fiber === referenceFiber?.alternate);
};

export const createUseFiberScenarios = ({
  createPortal,
  react,
  useFiber,
  useReferenceFiber,
}: UseFiberScenariosOptions): React.ComponentType => {
  const useFiberMatch = (): boolean => {
    const referenceFiber = useReferenceFiber();
    const firstFiber = useFiber();
    const secondFiber = useFiber();
    return firstFiber === secondFiber && isMatchingReferenceFiber(firstFiber, referenceFiber);
  };

  const createMatchOutput = (testId: string, isMatch: boolean, value?: React.ReactNode) =>
    react.createElement(
      "output",
      { "data-fiber-match": String(isMatch), "data-testid": testId },
      value ?? String(isMatch),
    );

  const SiblingProbe = ({ revision }: RevisionProps) => {
    const isMatch = useFiberMatch();
    return createMatchOutput(`use-fiber-sibling-${revision}`, isMatch);
  };

  const HookOrderProbe = () => {
    const [revision, setRevision] = react.useState(0);
    const isMatch = useFiberMatch();
    react.useReducer((state: number) => state, revision);
    return react.createElement(
      "button",
      {
        "data-fiber-match": String(isMatch),
        "data-testid": "use-fiber-hook-order",
        onClick: () => setRevision((previousRevision) => previousRevision + 1),
      },
      revision,
    );
  };

  const ForwardRefProbe = react.forwardRef<HTMLDivElement>((_properties, forwardedReference) => {
    const isMatch = useFiberMatch();
    return react.createElement(
      "div",
      {
        "data-fiber-match": String(isMatch),
        "data-testid": "use-fiber-forward-ref",
        ref: forwardedReference,
      },
      String(isMatch),
    );
  });

  const MemoProbe = react.memo(({ revision }: RevisionProps) => {
    const isMatch = useFiberMatch();
    return createMatchOutput("use-fiber-memo", isMatch, revision);
  });

  const MemoHarness = () => {
    const [revision, setRevision] = react.useState(0);
    return react.createElement(
      react.Fragment,
      null,
      react.createElement(
        "button",
        {
          "data-testid": "use-fiber-memo-update",
          onClick: () => setRevision((previousRevision) => previousRevision + 1),
        },
        revision,
      ),
      react.createElement(MemoProbe, { revision }),
    );
  };

  const RenderPhaseProbe = () => {
    const didEveryRenderMatch = react.useRef(true);
    const isMatch = useFiberMatch();
    didEveryRenderMatch.current &&= isMatch;
    const [revision, setRevision] = react.useState(0);
    if (revision === 0) setRevision(1);
    return createMatchOutput("use-fiber-render-phase", didEveryRenderMatch.current, revision);
  };

  const useCommitEffect = typeof window === "undefined" ? react.useEffect : react.useLayoutEffect;
  const CommitPhaseUpdateProbe = () => {
    const [revision, setRevision] = react.useState(0);
    const didEveryRenderMatch = react.useRef(true);
    didEveryRenderMatch.current &&= useFiberMatch();
    useCommitEffect(() => {
      if (revision === 0) setRevision(1);
    }, [revision]);
    return createMatchOutput("use-fiber-commit-phase", didEveryRenderMatch.current, revision);
  };

  const BatchedUpdateProbe = () => {
    const [revision, setRevision] = react.useState(0);
    const isMatch = useFiberMatch();
    const updateRevision = () => {
      setRevision((previousRevision) => previousRevision + 1);
      setRevision((previousRevision) => previousRevision + 1);
    };
    return react.createElement(
      "button",
      {
        "data-fiber-match": String(isMatch),
        "data-testid": "use-fiber-batched-update",
        onClick: updateRevision,
      },
      revision,
    );
  };

  const RemountProbe = ({ generation }: RemountProbeProps) => {
    const isMatch = useFiberMatch();
    return createMatchOutput("use-fiber-remount-result", isMatch, generation);
  };

  const RemountHarness = () => {
    const [generation, setGeneration] = react.useState(0);
    return react.createElement(
      react.Fragment,
      null,
      react.createElement(
        "button",
        {
          "data-testid": "use-fiber-remount",
          onClick: () => setGeneration((previousGeneration) => previousGeneration + 1),
        },
        generation,
      ),
      react.createElement(RemountProbe, { generation, key: generation }),
    );
  };

  const TransitionProbe = () => {
    const [revision, setRevision] = react.useState(0);
    const isMatch = useFiberMatch();
    const startTransition = Reflect.get(react, "startTransition");
    const updateRevision = () => {
      if (typeof startTransition === "function") {
        startTransition(() => setRevision((previousRevision) => previousRevision + 1));
      } else {
        setRevision((previousRevision) => previousRevision + 1);
      }
    };
    return react.createElement(
      "button",
      {
        "data-fiber-match": String(isMatch),
        "data-testid": "use-fiber-transition",
        onClick: updateRevision,
      },
      revision,
    );
  };

  let didSuspendedRenderMatch = true;
  let isSuspenseResolved = false;
  let resolveSuspense: (() => void) | undefined;
  const suspensePromise = new Promise<void>((resolvePromise) => {
    resolveSuspense = resolvePromise;
  });

  const SuspenseProbe = () => {
    const isMatch = useFiberMatch();
    didSuspendedRenderMatch &&= isMatch;
    if (!isSuspenseResolved) throw suspensePromise;
    return createMatchOutput("use-fiber-suspense-result", didSuspendedRenderMatch);
  };

  const SuspenseFallback = () =>
    createMatchOutput("use-fiber-suspense-fallback", didSuspendedRenderMatch);

  const SuspenseHarness = () => {
    const [isVisible, setIsVisible] = react.useState(false);
    const resolveSuspenseBoundary = () => {
      isSuspenseResolved = true;
      resolveSuspense?.();
    };
    return react.createElement(
      react.Fragment,
      null,
      react.createElement(
        "button",
        { "data-testid": "use-fiber-suspense-show", onClick: () => setIsVisible(true) },
        String(isVisible),
      ),
      react.createElement(
        "button",
        {
          "data-testid": "use-fiber-suspense-resolve",
          onClick: resolveSuspenseBoundary,
        },
        String(isSuspenseResolved),
      ),
      isVisible
        ? react.createElement(
            react.Suspense,
            { fallback: react.createElement(SuspenseFallback) },
            react.createElement(SuspenseProbe),
          )
        : null,
    );
  };

  const LazyProbeInner = () => {
    const isMatch = useFiberMatch();
    return createMatchOutput("use-fiber-lazy-result", isMatch);
  };
  let resolveLazyModule: ((module: LazyScenarioModule) => void) | undefined;
  const lazyModulePromise = new Promise<LazyScenarioModule>((resolveModule) => {
    resolveLazyModule = resolveModule;
  });
  const LazyProbe = react.lazy(() => lazyModulePromise);

  const LazyHarness = () => {
    const [isVisible, setIsVisible] = react.useState(false);
    return react.createElement(
      react.Fragment,
      null,
      react.createElement(
        "button",
        { "data-testid": "use-fiber-lazy-show", onClick: () => setIsVisible(true) },
        String(isVisible),
      ),
      react.createElement(
        "button",
        {
          "data-testid": "use-fiber-lazy-resolve",
          onClick: () => resolveLazyModule?.({ default: LazyProbeInner }),
        },
        "resolve",
      ),
      isVisible
        ? react.createElement(
            react.Suspense,
            {
              fallback: react.createElement(
                "output",
                { "data-testid": "use-fiber-lazy-fallback" },
                "loading",
              ),
            },
            react.createElement(LazyProbe),
          )
        : null,
    );
  };

  let didThrowingRenderMatch = false;
  const ThrowingProbe = () => {
    didThrowingRenderMatch = useFiberMatch();
    throw new Error("expected useFiber fixture error");
  };

  class ScenarioErrorBoundary extends react.Component<
    ScenarioErrorBoundaryProps,
    ScenarioErrorBoundaryState
  > {
    override state = { hasError: false };

    static getDerivedStateFromError(): ScenarioErrorBoundaryState {
      return { hasError: true };
    }

    override render() {
      return this.state.hasError
        ? createMatchOutput("use-fiber-error-result", didThrowingRenderMatch)
        : this.props.children;
    }
  }

  const ErrorHarness = () => {
    const [isVisible, setIsVisible] = react.useState(false);
    return react.createElement(
      react.Fragment,
      null,
      react.createElement(
        "button",
        { "data-testid": "use-fiber-error-show", onClick: () => setIsVisible(true) },
        String(isVisible),
      ),
      isVisible
        ? react.createElement(ScenarioErrorBoundary, null, react.createElement(ThrowingProbe))
        : null,
    );
  };

  const PortalProbe = () => {
    const isMatch = useFiberMatch();
    return createMatchOutput("use-fiber-portal", isMatch);
  };

  const PortalHarness = () => {
    const [portalContainer, setPortalContainer] = react.useState<HTMLElement | null>(null);
    react.useEffect(() => {
      const container = document.createElement("div");
      container.dataset.testid = "use-fiber-portal-container";
      document.body.appendChild(container);
      setPortalContainer(container);
      return () => container.remove();
    }, []);
    return portalContainer ? createPortal(react.createElement(PortalProbe), portalContainer) : null;
  };

  const UseFiberScenarios = () =>
    react.createElement(
      "section",
      { "data-testid": "use-fiber-scenarios" },
      react.createElement(SiblingProbe, { revision: 1 }),
      react.createElement(SiblingProbe, { revision: 2 }),
      react.createElement(HookOrderProbe),
      react.createElement(ForwardRefProbe),
      react.createElement(MemoHarness),
      react.createElement(RenderPhaseProbe),
      react.createElement(CommitPhaseUpdateProbe),
      react.createElement(BatchedUpdateProbe),
      react.createElement(RemountHarness),
      react.createElement(TransitionProbe),
      react.createElement(SuspenseHarness),
      react.createElement(LazyHarness),
      react.createElement(ErrorHarness),
      react.createElement(PortalHarness),
    );

  return UseFiberScenarios;
};
