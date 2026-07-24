import "../src/index.js"; // KEEP THIS LINE ON TOP

import { beforeAll, describe, expect, it } from "vitest";
import type { Fiber } from "../src/types.js";
import { getRDTHook, _renderers } from "../src/index.js";
import { getFiberHooks, type HooksNode } from "../src/source/inspect-hooks.js";
import React from "react";
import { render } from "@testing-library/react";

const FUNCTION_COMPONENT_TAG = 0;
const CONTEXT_PROVIDER_TAG = 10;
const FORWARD_REF_TAG = 11;
const HOST_COMPONENT_TAG = 5;

interface ActiveDispatcher {
  [hookName: string]: (...args: unknown[]) => unknown;
}

const getActiveDispatcher = (): ActiveDispatcher => {
  const rdtHook = getRDTHook();
  for (const renderer of [..._renderers, ...rdtHook.renderers.values()]) {
    const dispatcherRef = renderer.currentDispatcherRef;
    if (dispatcherRef && typeof dispatcherRef === "object") {
      const container = dispatcherRef as { H?: unknown; current?: unknown };
      const dispatcher = "H" in container ? container.H : container.current;
      return dispatcher as ActiveDispatcher;
    }
  }
  throw new Error("No dispatcher available");
};

interface FakeFiberShape {
  tag?: number;
  type: unknown;
  elementType?: unknown;
  memoizedState?: unknown;
  memoizedProps?: Record<string, unknown>;
  updateQueue?: unknown;
  ref?: unknown;
  returnFiber?: unknown;
}

const createInspectableFiber = (
  shape: FakeFiberShape,
  dependencyFields: Record<string, unknown> = { dependencies: null },
): Fiber => {
  const fiber: Record<string, unknown> = {
    tag: shape.tag ?? FUNCTION_COMPONENT_TAG,
    type: shape.type,
    elementType: "elementType" in shape ? shape.elementType : shape.type,
    memoizedState: shape.memoizedState ?? null,
    memoizedProps: shape.memoizedProps ?? {},
    updateQueue: shape.updateQueue ?? null,
    ref: shape.ref ?? null,
    child: null,
    sibling: null,
    return: shape.returnFiber ?? null,
  };
  Object.assign(fiber, dependencyFields);
  return fiber as unknown as Fiber;
};

interface HookChainNode {
  memoizedState: unknown;
  next: HookChainNode | null;
}

const createHookChain = (hookStates: unknown[]): HookChainNode | null =>
  hookStates.reduceRight<HookChainNode | null>(
    (nextHookNode, memoizedState) => ({ memoizedState, next: nextHookNode }),
    null,
  );

const collectValues = (hooksTree: HooksNode[]): unknown[] => {
  const hookValues: unknown[] = [];
  const walk = (nodes: HooksNode[]): void => {
    for (const node of nodes) {
      hookValues.push(node.value);
      walk(node.subHooks);
    }
  };
  walk(hooksTree);
  return hookValues;
};

beforeAll(() => {
  render(<span />);
});

describe("use() inspection", () => {
  it("records fulfilled thenables", () => {
    const fulfilledThenable = { then: () => {}, status: "fulfilled", value: 42 };
    const UseFulfilledComponent = (): null => {
      React.use(fulfilledThenable as unknown as Promise<number>);
      return null;
    };
    const fiber = createInspectableFiber({ type: UseFulfilledComponent });
    expect(collectValues(getFiberHooks(fiber))).toContain(42);
  });

  it("records unresolved thenables without throwing", () => {
    const pendingThenable = { then: () => {} };
    const UsePendingComponent = (): null => {
      React.use(pendingThenable as unknown as Promise<number>);
      return null;
    };
    const fiber = createInspectableFiber({ type: UsePendingComponent });
    expect(collectValues(getFiberHooks(fiber))).toContain(pendingThenable);
  });

  it("propagates rejected thenable reasons as render errors", () => {
    const rejectedThenable = {
      then: () => {},
      status: "rejected",
      reason: new Error("promise failed"),
    };
    const UseRejectedComponent = (): null => {
      React.use(rejectedThenable as unknown as Promise<number>);
      return null;
    };
    const fiber = createInspectableFiber({ type: UseRejectedComponent });
    expect(() => getFiberHooks(fiber)).toThrowError(
      expect.objectContaining({ name: "ReactDebugToolsRenderError" }),
    );
  });

  it("reads contexts through use()", () => {
    const UsableContext = React.createContext("usable-default");
    const UseContextComponent = (): null => {
      React.use(UsableContext);
      return null;
    };
    const fiber = createInspectableFiber(
      { type: UseContextComponent },
      {
        dependencies: {
          firstContext: { context: UsableContext, memoizedValue: "usable-value", next: null },
        },
      },
    );
    expect(collectValues(getFiberHooks(fiber))).toContain("usable-value");
  });

  it("throws a render error for unsupported usables", () => {
    const UseNumberComponent = (): null => {
      React.use(42 as unknown as Promise<number>);
      return null;
    };
    const fiber = createInspectableFiber({ type: UseNumberComponent });
    expect(() => getFiberHooks(fiber)).toThrowError(
      expect.objectContaining({ name: "ReactDebugToolsRenderError" }),
    );
  });

  it("rejects context-tagged objects without a current value", () => {
    const contextTypeSymbol = (React.createContext("real") as unknown as { $$typeof: symbol })
      .$$typeof;
    const contextLikeObject = { $$typeof: contextTypeSymbol };
    const UseContextLikeComponent = (): null => {
      React.use(contextLikeObject as unknown as Promise<string>);
      return null;
    };
    const fiber = createInspectableFiber({ type: UseContextLikeComponent });
    expect(() => getFiberHooks(fiber)).toThrowError(
      expect.objectContaining({ name: "ReactDebugToolsRenderError" }),
    );
  });

  it("replays thenables recorded in the debug thenable state", () => {
    const cachedThenable = { then: () => {}, status: "fulfilled", value: "cached-value" };
    const pendingThenable = { then: () => {} };
    const UseCachedComponent = (): null => {
      React.use(pendingThenable as unknown as Promise<string>);
      return null;
    };
    const fiber = createInspectableFiber(
      { type: UseCachedComponent },
      {
        dependencies: {
          firstContext: null,
          _debugThenableState: { thenables: [cachedThenable] },
        },
      },
    );
    expect(collectValues(getFiberHooks(fiber))).toContain("cached-value");
  });

  it("replays thenables when the debug thenable state is itself an array", () => {
    const cachedThenable = { then: () => {}, status: "fulfilled", value: "array-cached" };
    const pendingThenable = { then: () => {} };
    const UseArrayCachedComponent = (): null => {
      React.use(pendingThenable as unknown as Promise<string>);
      return null;
    };
    const fiber = createInspectableFiber(
      { type: UseArrayCachedComponent },
      {
        dependencies: {
          firstContext: null,
          _debugThenableState: [cachedThenable],
        },
      },
    );
    expect(collectValues(getFiberHooks(fiber))).toContain("array-cached");
  });
});

describe("uncommitted hook initializers", () => {
  it("invokes lazy useState initializers when no hook is committed", () => {
    const LazyStateComponent = (): null => {
      React.useState(() => "lazy-initial-state");
      return null;
    };
    const fiber = createInspectableFiber({ type: LazyStateComponent });
    expect(collectValues(getFiberHooks(fiber))).toContain("lazy-initial-state");
  });

  it("invokes useReducer init functions when no hook is committed", () => {
    const InitReducerComponent = (): null => {
      React.useReducer(
        (state: string) => state,
        "raw-arg",
        (initialArg) => `${initialArg}-initialized`,
      );
      return null;
    };
    const fiber = createInspectableFiber({ type: InitReducerComponent });
    expect(collectValues(getFiberHooks(fiber))).toContain("raw-arg-initialized");
  });
});

describe("context dependency handling", () => {
  it("throws a render error when context reads do not line up", () => {
    const OrphanContext = React.createContext("orphan");
    const MismatchedContextComponent = (): null => {
      React.useContext(OrphanContext);
      return null;
    };
    const fiber = createInspectableFiber({ type: MismatchedContextComponent });
    expect(() => getFiberHooks(fiber)).toThrowError(
      expect.objectContaining({ name: "ReactDebugToolsRenderError" }),
    );
  });

  it("reads provider values for legacy dependencies without memoized values", () => {
    const ProvidedContext = React.createContext("default-a");
    const LegacyWrappedContext = React.createContext("default-b");

    const duplicateProviderFiber = createInspectableFiber({
      tag: CONTEXT_PROVIDER_TAG,
      type: ProvidedContext,
      memoizedProps: { value: "shadowed" },
    });
    const legacyProviderFiber = createInspectableFiber({
      tag: CONTEXT_PROVIDER_TAG,
      type: { _context: LegacyWrappedContext },
      memoizedProps: { value: "provided-b" },
      returnFiber: duplicateProviderFiber,
    });
    const hostFiber = createInspectableFiber({
      tag: HOST_COMPONENT_TAG,
      type: "div",
      returnFiber: legacyProviderFiber,
    });
    const providerFiber = createInspectableFiber({
      tag: CONTEXT_PROVIDER_TAG,
      type: ProvidedContext,
      memoizedProps: { value: "provided-a" },
      returnFiber: hostFiber,
    });

    const LegacyContextComponent = (): null => {
      React.useContext(ProvidedContext);
      return null;
    };
    const fiber = createInspectableFiber(
      { type: LegacyContextComponent, returnFiber: providerFiber },
      { dependencies: { firstContext: { context: ProvidedContext } } },
    );

    const readCurrentContextValue = (context: unknown): unknown =>
      (context as { _currentValue: unknown })._currentValue;

    expect(collectValues(getFiberHooks(fiber))).toContain("provided-a");
    expect(readCurrentContextValue(ProvidedContext)).toBe("default-a");
    expect(readCurrentContextValue(LegacyWrappedContext)).toBe("default-b");
  });
});

describe("useActionState inspection with committed thenables", () => {
  const createActionStateComponent = (): (() => null) => {
    const ActionStateFakeComponent = (): null => {
      React.useActionState((previousState: string) => previousState, "fallback-state");
      return null;
    };
    return ActionStateFakeComponent;
  };

  it("unwraps fulfilled action thenables", () => {
    const fulfilledThenable = { then: () => {}, status: "fulfilled", value: "action-done" };
    const fiber = createInspectableFiber({
      type: createActionStateComponent(),
      memoizedState: createHookChain([fulfilledThenable, null, null]),
    });
    expect(collectValues(getFiberHooks(fiber))).toContain("action-done");
  });

  it("throws a render error for rejected action thenables", () => {
    const rejectedThenable = {
      then: () => {},
      status: "rejected",
      reason: new Error("action failed"),
    };
    const fiber = createInspectableFiber({
      type: createActionStateComponent(),
      memoizedState: createHookChain([rejectedThenable, null, null]),
    });
    expect(() => getFiberHooks(fiber)).toThrowError(
      expect.objectContaining({ name: "ReactDebugToolsRenderError" }),
    );
  });

  it("records pending action thenables without throwing", () => {
    const pendingThenable = { then: () => {} };
    const fiber = createInspectableFiber({
      type: createActionStateComponent(),
      memoizedState: createHookChain([pendingThenable, null, null]),
    });
    expect(collectValues(getFiberHooks(fiber))).toContain(pendingThenable);
  });
});

describe("forwardRef and default props", () => {
  it("applies default props when the element type differs", () => {
    let capturedProps: Record<string, unknown> | null = null;
    const forwardRefType = {
      render: (props: Record<string, unknown>): null => {
        capturedProps = props;
        return null;
      },
      defaultProps: { greeting: "hello", explicit: "ignored" },
    };
    const fiber = createInspectableFiber({
      tag: FORWARD_REF_TAG,
      type: forwardRefType,
      elementType: null,
      memoizedProps: { explicit: "set" },
    });

    getFiberHooks(fiber);

    expect(capturedProps).toEqual({ greeting: "hello", explicit: "set" });
  });
});

describe("dispatcher-only hooks", () => {
  it("serves useMemoCache data from the fiber update queue", () => {
    const existingCacheEntry = ["existing-entry"];
    const memoCache = { data: [existingCacheEntry], index: 7 };
    let capturedCacheData: unknown[][] = [];
    const MemoCacheComponent = (): null => {
      const dispatcher = getActiveDispatcher();
      capturedCacheData = [
        dispatcher.useMemoCache(2) as unknown[],
        dispatcher.useMemoCache(3) as unknown[],
      ];
      return null;
    };
    const fiber = createInspectableFiber({
      type: MemoCacheComponent,
      updateQueue: { memoCache },
    });

    getFiberHooks(fiber);

    expect(capturedCacheData[0]).toEqual(existingCacheEntry);
    expect(capturedCacheData[0]).not.toBe(existingCacheEntry);
    expect(capturedCacheData[1]).toHaveLength(3);
    capturedCacheData[0][0] = "inspection-write";
    expect(memoCache).toEqual({ data: [existingCacheEntry], index: 7 });
  });

  it("returns an empty cache when the update queue has none", () => {
    let capturedCacheData: unknown[] | null = null;
    const NoCacheComponent = (): null => {
      capturedCacheData = getActiveDispatcher().useMemoCache(4) as unknown[];
      return null;
    };
    const fiber = createInspectableFiber({ type: NoCacheComponent });

    getFiberHooks(fiber);

    expect(capturedCacheData).toEqual([]);
  });

  it("reads committed cache refresh functions", () => {
    const committedRefresh = (): void => {};
    const CacheRefreshComponent = (): null => {
      getActiveDispatcher().useCacheRefresh();
      return null;
    };
    const fiber = createInspectableFiber({
      type: CacheRefreshComponent,
      memoizedState: createHookChain([committedRefresh]),
    });

    expect(collectValues(getFiberHooks(fiber))).toContain(committedRefresh);
  });

  it("reads the host transition status from context dependencies", () => {
    const HostTransitionStatusComponent = (): null => {
      getActiveDispatcher().useHostTransitionStatus();
      return null;
    };
    const fiber = createInspectableFiber(
      { type: HostTransitionStatusComponent },
      {
        dependencies: {
          firstContext: { context: null, memoizedValue: "transition-idle", next: null },
        },
      },
    );

    expect(collectValues(getFiberHooks(fiber))).toContain("transition-idle");
  });

  it("throws for hooks missing from the dispatcher", () => {
    const BogusHookComponent = (): null => {
      getActiveDispatcher().useBogusHook();
      return null;
    };
    const fiber = createInspectableFiber({ type: BogusHookComponent });
    expect(() => getFiberHooks(fiber)).toThrowError("Missing method in Dispatcher: useBogusHook");
  });
});

interface DetachedDispatcherFunctions {
  useDebugValue: (value: unknown) => void;
  useState: (initialState: unknown) => [unknown, () => void];
}

// HACK: calling dispatcher methods detached (not through the proxy receiver)
// keeps V8 from prefixing frames with "Proxy.", so the hook stack matches the
// primitive stack cache exactly like a production React wrapper call would
const detachedDispatcher: DetachedDispatcherFunctions = {
  useDebugValue: () => {},
  useState: (initialState) => [initialState, () => {}],
};

const captureDetachedDispatcher = (): void => {
  const dispatcher = getActiveDispatcher();
  detachedDispatcher.useDebugValue = dispatcher.useDebugValue as (value: unknown) => void;
  detachedDispatcher.useState = dispatcher.useState as (
    initialState: unknown,
  ) => [unknown, () => void];
};

const useDebugValue = (value: unknown): void => {
  detachedDispatcher.useDebugValue(value);
};

const experimental_useDebugValue = (value: unknown): void => {
  useDebugValue(value);
};

const useStatusWithNote = (): unknown => {
  const [status] = detachedDispatcher.useState("noted-status");
  useDebugValue("status-note");
  return status;
};

const useStatusWithManyNotes = (): unknown => {
  const [status] = detachedDispatcher.useState("many-notes-status");
  useDebugValue("first-note");
  useDebugValue("second-note");
  return status;
};

const useStatusWithWrappedNote = (): unknown => {
  const [status] = detachedDispatcher.useState("wrapped-status");
  experimental_useDebugValue("wrapped-note");
  return status;
};

const findNodeByName = (hooksTree: HooksNode[], name: string): HooksNode | null => {
  for (const node of hooksTree) {
    if (node.name === name) return node;
    const nestedMatch = findNodeByName(node.subHooks, name);
    if (nestedMatch) return nestedMatch;
  }
  return null;
};

describe("debug value attribution through react-like wrappers", () => {
  it("assigns a single debug value to the enclosing custom hook", () => {
    const NotedComponent = (): null => {
      captureDetachedDispatcher();
      useStatusWithNote();
      return null;
    };
    const fiber = createInspectableFiber({ type: NotedComponent });

    const hooksTree = getFiberHooks(fiber);

    const customHookNode = findNodeByName(hooksTree, "StatusWithNote");
    expect(customHookNode?.value).toBe("status-note");
    expect(findNodeByName(hooksTree, "DebugValue")).toBeNull();
  });

  it("collects multiple debug values into an array on the custom hook", () => {
    const ManyNotesComponent = (): null => {
      captureDetachedDispatcher();
      useStatusWithManyNotes();
      return null;
    };
    const fiber = createInspectableFiber({ type: ManyNotesComponent });

    const hooksTree = getFiberHooks(fiber);

    const customHookNode = findNodeByName(hooksTree, "StatusWithManyNotes");
    expect(customHookNode?.value).toEqual(["first-note", "second-note"]);
  });

  it("skips stacked wrappers that both parse to the dispatcher hook name", () => {
    const WrappedNoteComponent = (): null => {
      captureDetachedDispatcher();
      useStatusWithWrappedNote();
      return null;
    };
    const fiber = createInspectableFiber({ type: WrappedNoteComponent });

    const hooksTree = getFiberHooks(fiber);

    expect(collectValues(hooksTree)).toContain("wrapped-note");
    expect(findNodeByName(hooksTree, "StatusWithWrappedNote")).not.toBeNull();
  });

  it("handles anonymous frames between the dispatcher and the component", () => {
    const anonymousCallers: Array<() => void> = [
      () => {
        detachedDispatcher.useState("anonymous-caller-state");
      },
    ];
    const AnonymousCallerComponent = (): null => {
      captureDetachedDispatcher();
      anonymousCallers[0]();
      return null;
    };
    const fiber = createInspectableFiber({ type: AnonymousCallerComponent });

    expect(collectValues(getFiberHooks(fiber))).toContain("anonymous-caller-state");
  });
});

describe("truncated stack handling", () => {
  it("builds a flat tree when stacks are truncated below the common root", () => {
    const previousStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    try {
      const TruncatedComponent = (): null => {
        React.useState("truncated-state");
        return null;
      };
      const fiber = createInspectableFiber({ type: TruncatedComponent });

      const hooksTree = getFiberHooks(fiber);

      expect(collectValues(hooksTree)).toContain("truncated-state");
      expect(hooksTree.every((node) => node.subHooks.length === 0)).toBe(true);
    } finally {
      Error.stackTraceLimit = previousStackTraceLimit;
    }
  });

  it("builds nodes without sources when stacks collapse to a single frame", () => {
    const previousStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 1;
    try {
      const SingleFrameComponent = (): null => {
        React.useState("single-frame-state");
        return null;
      };
      const fiber = createInspectableFiber({ type: SingleFrameComponent });

      const hooksTree = getFiberHooks(fiber);

      expect(collectValues(hooksTree)).toContain("single-frame-state");
    } finally {
      Error.stackTraceLimit = previousStackTraceLimit;
    }
  });
});

describe("resolveContextDependency version support", () => {
  const NoopComponent = (): null => null;

  it("supports fibers with dependencies_old", () => {
    const withoutDependencies = createInspectableFiber(
      { type: NoopComponent },
      { dependencies_old: null },
    );
    expect(getFiberHooks(withoutDependencies)).toEqual([]);

    const withFirstContext = createInspectableFiber(
      { type: NoopComponent },
      { dependencies_old: { firstContext: null } },
    );
    expect(getFiberHooks(withFirstContext)).toEqual([]);
  });

  it("supports fibers with dependencies_new", () => {
    const withFirstContext = createInspectableFiber(
      { type: NoopComponent },
      { dependencies_new: { firstContext: null } },
    );
    expect(getFiberHooks(withFirstContext)).toEqual([]);

    const withoutDependencies = createInspectableFiber(
      { type: NoopComponent },
      { dependencies_new: null },
    );
    expect(getFiberHooks(withoutDependencies)).toEqual([]);
  });

  it("supports fibers with contextDependencies", () => {
    const withFirst = createInspectableFiber(
      { type: NoopComponent },
      { contextDependencies: { first: null } },
    );
    expect(getFiberHooks(withFirst)).toEqual([]);

    const withoutFirst = createInspectableFiber(
      { type: NoopComponent },
      { contextDependencies: null },
    );
    expect(getFiberHooks(withoutFirst)).toEqual([]);
  });

  it("throws for unsupported react versions", () => {
    const fiber = createInspectableFiber({ type: NoopComponent }, {});
    expect(() => getFiberHooks(fiber)).toThrowError("Unsupported React version.");
  });
});
