import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { getReactWorkTagsForFiber, setReactWorkTagsForFiber, traverseFiber } from "bippy";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { getFiberDisplayName, getFiberTypeName } from "../src/fiber-metadata.js";
import type { Fiber } from "bippy";
import type { Facade } from "../src/types.js";

interface FiberOverrides extends Partial<Omit<Fiber, "tag">> {
  tag: number;
}

let facade: Facade;
let templateFiber: Fiber;

const createFiber = ({ tag, ...overrides }: FiberOverrides): Fiber => {
  const fiber: Fiber = {
    ...templateFiber,
    alternate: null,
    child: null,
    return: templateFiber,
    sibling: null,
    ...overrides,
  };
  Reflect.set(fiber, "tag", tag);
  return fiber;
};

beforeEach(() => {
  facade = installFacade();
  const App = () => <div />;
  render(<App />);
  const root = facade.fiberRoots.values().next().value?.values().next().value;
  if (!root) throw new Error("Missing root");
  templateFiber =
    traverseFiber(root.current, (fiber) => typeof fiber.type === "function") ?? root.current;
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream Fiber metadata policy", () => {
  it("By default, component display names should not have Forget prefix", () => {
    const workTags = getReactWorkTagsForFiber(templateFiber);
    const Component = () => null;
    const fiber = createFiber({ tag: workTags.FunctionComponent, type: Component });
    setReactWorkTagsForFiber(fiber);
    expect(getFiberDisplayName(fiber)).toBe("Component");
  });

  it("If useMemoCache used, the corresponding displayName for a component should have Forget prefix", () => {
    const workTags = getReactWorkTagsForFiber(templateFiber);
    const Component = () => null;
    const fiber = createFiber({ tag: workTags.FunctionComponent, type: Component });
    Reflect.set(fiber, "updateQueue", { memoCache: {} });
    setReactWorkTagsForFiber(fiber);
    expect(getFiberDisplayName(fiber)).toBe("Forget(Component)");
  });

  it("classifies every supported DevTools element kind", () => {
    const workTags = getReactWorkTagsForFiber(templateFiber);
    const expectations: Array<[number, string]> = [
      [workTags.FunctionComponent, "function"],
      [workTags.IncompleteFunctionComponent, "function"],
      [workTags.IndeterminateComponent, "function"],
      [workTags.ClassComponent, "class"],
      [workTags.IncompleteClassComponent, "class"],
      [workTags.HostComponent, "host"],
      [workTags.HostHoistable, "host"],
      [workTags.HostSingleton, "host"],
      [workTags.HostRoot, "root"],
      [workTags.ForwardRef, "forwardRef"],
      [workTags.MemoComponent, "memo"],
      [workTags.SimpleMemoComponent, "memo"],
      [workTags.ContextConsumer, "context"],
      [workTags.ContextProvider, "context"],
      [workTags.SuspenseComponent, "suspense"],
      [workTags.SuspenseListComponent, "suspenseList"],
      [workTags.LazyComponent, "lazy"],
      [workTags.Profiler, "profiler"],
      [workTags.HostPortal, "portal"],
      [workTags.ActivityComponent, "activity"],
      [workTags.ViewTransitionComponent, "viewTransition"],
      [workTags.CacheComponent, "cache"],
      [workTags.ScopeComponent, "scope"],
      [workTags.OffscreenComponent, "offscreen"],
      [workTags.LegacyHiddenComponent, "offscreen"],
      [workTags.Throw, "throw"],
      [workTags.HostText, "text"],
      [workTags.Fragment, "fragment"],
      [workTags.DehydratedSuspenseComponent, "dehydrated"],
      [workTags.Mode, "mode"],
      [10_000, "unknown"],
    ];

    for (const [tag, expectedType] of expectations) {
      const fiber = createFiber({ tag });
      setReactWorkTagsForFiber(fiber);
      expect(getFiberTypeName(fiber)).toBe(expectedType);
    }
  });

  it("formats display names using upstream wrapper and built-in conventions", () => {
    const workTags = getReactWorkTagsForFiber(templateFiber);
    const Named = () => null;
    const expectations: Array<[FiberOverrides, string | null]> = [
      [{ tag: workTags.ActivityComponent }, "Activity"],
      [{ tag: workTags.CacheComponent }, "Cache"],
      [{ tag: workTags.FunctionComponent, type: Named }, "Named"],
      [{ tag: workTags.IncompleteFunctionComponent, type: Named }, "Named"],
      [{ tag: workTags.IndeterminateComponent, type: Named }, "Named"],
      [{ tag: workTags.ClassComponent, type: Named }, "Named"],
      [{ tag: workTags.IncompleteClassComponent, type: Named }, "Named"],
      [{ elementType: { displayName: "Forwarded" }, tag: workTags.ForwardRef }, "Forwarded"],
      [
        { elementType: null, tag: workTags.ForwardRef, type: { render: Named } },
        "ForwardRef(Named)",
      ],
      [{ stateNode: { _debugRootType: "createRoot()" }, tag: workTags.HostRoot }, "createRoot()"],
      [{ stateNode: {}, tag: workTags.HostRoot }, "Root"],
      [{ tag: workTags.HostComponent, type: "main" }, "main"],
      [{ tag: workTags.HostHoistable, type: "link" }, "link"],
      [{ tag: workTags.HostSingleton, type: "html" }, "html"],
      [{ tag: workTags.Fragment }, "Fragment"],
      [{ tag: workTags.LazyComponent }, "Lazy"],
      [{ elementType: { displayName: "Memoized" }, tag: workTags.MemoComponent }, "Memoized"],
      [{ elementType: null, tag: workTags.SimpleMemoComponent, type: Named }, "Memo(Named)"],
      [
        { tag: workTags.ContextConsumer, type: { _context: { displayName: "Theme" } } },
        "Theme.Consumer",
      ],
      [
        { tag: workTags.ContextProvider, type: { context: { displayName: "Theme" } } },
        "Theme.Provider",
      ],
      [{ tag: workTags.SuspenseComponent }, "Suspense"],
      [{ tag: workTags.LegacyHiddenComponent }, "LegacyHidden"],
      [{ tag: workTags.OffscreenComponent }, "Offscreen"],
      [{ tag: workTags.ScopeComponent }, "Scope"],
      [{ tag: workTags.SuspenseListComponent }, "SuspenseList"],
      [{ memoizedProps: { id: "chart" }, tag: workTags.Profiler }, "Profiler(chart)"],
      [{ memoizedProps: {}, tag: workTags.Profiler }, "Profiler"],
      [{ tag: workTags.TracingMarkerComponent }, "TracingMarker"],
      [{ tag: workTags.ViewTransitionComponent }, "ViewTransition"],
      [{ tag: workTags.Throw }, "Error"],
      [{ tag: workTags.HostText }, null],
    ];

    for (const [overrides, expectedName] of expectations) {
      const fiber = createFiber(overrides);
      setReactWorkTagsForFiber(fiber);
      expect(getFiberDisplayName(fiber)).toBe(expectedName);
    }
  });

  it("uses context fallbacks and the React Compiler Forget wrapper", () => {
    const workTags = getReactWorkTagsForFiber(templateFiber);
    const contextFiber = createFiber({ tag: workTags.ContextProvider, type: {} });
    setReactWorkTagsForFiber(contextFiber);
    expect(getFiberDisplayName(contextFiber)).toBe("Context.Provider");

    const Compiled = () => null;
    const compiledFiber = createFiber({ tag: workTags.FunctionComponent, type: Compiled });
    Reflect.set(compiledFiber, "updateQueue", { memoCache: {} });
    setReactWorkTagsForFiber(compiledFiber);
    expect(getFiberDisplayName(compiledFiber)).toBe("Forget(Compiled)");
  });
});
