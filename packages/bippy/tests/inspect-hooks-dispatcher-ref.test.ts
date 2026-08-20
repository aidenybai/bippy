import { describe, expect, it } from "vite-plus/test";
import { getRDTHook, instrument } from "../src/core.js";
import type { ReactDevToolsTarget } from "../src/rdt-hook.js";
import {
  ReactBuildType,
  type Fiber,
  type FiberRoot,
  type ReactRenderer,
} from "../src/react-internals/index.js";
import { _renderers } from "../src/rdt-hook.js";
import { getFiberHooks, inspectHooks, type HooksNode } from "../src/source/inspect-hooks.js";
import { latestReactWorkTags } from "./react-work-tags.js";

const createFakeFiber = (type: unknown): Fiber =>
  ({
    alternate: null,
    flags: 0,
    tag: latestReactWorkTags.FunctionComponent,
    type,
    elementType: type,
    memoizedState: null,
    memoizedProps: {},
    updateQueue: null,
    dependencies: null,
    ref: null,
    child: null,
    sibling: null,
    return: null,
  }) as unknown as Fiber;

describe("getFiberHooks dispatcher discovery", () => {
  it("throws when no react renderer is registered", () => {
    const fiber = createFakeFiber(() => null);
    expect(() => getFiberHooks(fiber)).toThrowError(
      "Bippy couldn’t find a React renderer. Load React and install Bippy’s hook.",
    );
  });

  it("uses the dispatcher from the fiber renderer", () => {
    const unrelatedDispatcherRef: { current: unknown } = { current: null };
    const fiberDispatcherRef: { current: unknown } = { current: null };
    const unrelatedRenderer: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: unrelatedDispatcherRef,
      rendererPackageName: "unrelated-renderer",
      version: "19.2.0",
    };
    const fiberRenderer: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: fiberDispatcherRef,
      rendererPackageName: "fiber-renderer",
      version: "19.2.0",
    };
    const Component = (): null => {
      if (typeof fiberDispatcherRef.current !== "object" || fiberDispatcherRef.current === null) {
        throw new Error("Expected the fiber renderer dispatcher");
      }
      const useState = Reflect.get(fiberDispatcherRef.current, "useState");
      if (typeof useState !== "function") throw new Error("Expected useState on the dispatcher");
      Reflect.apply(useState, fiberDispatcherRef.current, ["fiber-state"]);
      return null;
    };
    const fiber = createFakeFiber(Component);
    const rootFiber = createFakeFiber(null);
    rootFiber.child = fiber;
    rootFiber.tag = latestReactWorkTags.HostRoot;
    Reflect.set(rootFiber, "memoizedState", { element: {} });
    fiber.return = rootFiber;
    const fiberRoot: FiberRoot = { current: rootFiber };
    rootFiber.stateNode = fiberRoot;
    const rdtHook = getRDTHook();
    const rendererId = 10_001;
    const unsubscribe = instrument({});
    _renderers.add(unrelatedRenderer);
    rdtHook.renderers.set(rendererId, fiberRenderer);
    rdtHook.onCommitFiberRoot(rendererId, fiberRoot, undefined);

    try {
      expect(getFiberHooks(fiber).some((hook) => hook.value === "fiber-state")).toBe(true);
      expect(unrelatedDispatcherRef.current).toBeNull();
      expect(fiberDispatcherRef.current).toBeNull();
    } finally {
      Reflect.set(rootFiber, "memoizedState", { element: null });
      rdtHook.onCommitFiberRoot(rendererId, fiberRoot, undefined);
      rdtHook.renderers.delete(rendererId);
      _renderers.delete(unrelatedRenderer);
      unsubscribe();
    }
  });

  it("uses the dispatcher from an explicit target for standalone inspection", () => {
    const target: ReactDevToolsTarget = {};
    const unrelatedDispatcherRef: { current: unknown } = { current: null };
    const targetDispatcherRef: { current: unknown } = { current: null };
    const unrelatedRenderer: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: unrelatedDispatcherRef,
      rendererPackageName: "unrelated-renderer",
      version: "19.2.0",
    };
    const targetRenderer: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: targetDispatcherRef,
      rendererPackageName: "target-renderer",
      version: "19.2.0",
    };
    const Component = (): null => {
      if (typeof targetDispatcherRef.current !== "object" || targetDispatcherRef.current === null) {
        throw new Error("Expected the target dispatcher");
      }
      const useState = Reflect.get(targetDispatcherRef.current, "useState");
      if (typeof useState !== "function") throw new Error("Expected useState on the dispatcher");
      Reflect.apply(useState, targetDispatcherRef.current, ["target-state"]);
      return null;
    };
    _renderers.add(unrelatedRenderer);
    getRDTHook(undefined, target).inject(targetRenderer);

    try {
      expect(
        inspectHooks(Component, {}, target).some((hook) => hook.value === "target-state"),
      ).toBe(true);
      expect(unrelatedDispatcherRef.current).toBeNull();
      expect(targetDispatcherRef.current).toBeNull();
    } finally {
      _renderers.delete(unrelatedRenderer);
      _renderers.delete(targetRenderer);
    }
  });

  it("supports renderers exposing a dispatcher ref with a current property", () => {
    const legacyDispatcherRef: { current: unknown } = { current: null };
    const rendererWithoutRef: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: null,
      rendererPackageName: "test-renderer",
      version: "19.2.0",
    };
    const legacyRenderer: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: legacyDispatcherRef,
      rendererPackageName: "test-renderer",
      version: "19.2.0",
    };
    _renderers.add(rendererWithoutRef);
    _renderers.add(legacyRenderer);

    try {
      let capturedState: unknown = null;
      const LegacyDispatcherComponent = (): null => {
        const dispatcher = legacyDispatcherRef.current as {
          useState: (initialState: unknown) => [unknown, () => void];
        };
        capturedState = dispatcher.useState("legacy-state")[0];
        return null;
      };
      const fiber = createFakeFiber(LegacyDispatcherComponent);

      const hooksTree = getFiberHooks(fiber);

      expect(capturedState).toBe("legacy-state");
      expect(legacyDispatcherRef.current).toBeNull();
      expect(hooksTree.length).toBeGreaterThanOrEqual(1);
    } finally {
      _renderers.delete(rendererWithoutRef);
      _renderers.delete(legacyRenderer);
    }
  });

  it("preserves debug information and recognizes recoverable use values", () => {
    const dispatcherRef: { current: unknown } = { current: null };
    const renderer: ReactRenderer = {
      bundleType: ReactBuildType.Development,
      currentDispatcherRef: dispatcherRef,
      rendererPackageName: "test-renderer",
      version: "19.2.0",
    };
    _renderers.add(renderer);
    const debugInfo = [{ name: "ServerData", env: "Server" }];

    try {
      const UseComponent = (): null => {
        if (typeof dispatcherRef.current !== "object" || dispatcherRef.current === null) {
          throw new Error("Expected an inspection dispatcher");
        }
        const use = Reflect.get(dispatcherRef.current, "use");
        if (typeof use !== "function") throw new Error("Expected use on the dispatcher");
        const fulfilledThenable = Promise.resolve("loaded");
        Reflect.set(fulfilledThenable, "status", "fulfilled");
        Reflect.set(fulfilledThenable, "value", "loaded");
        Reflect.set(fulfilledThenable, "_debugInfo", debugInfo);
        Reflect.apply(use, dispatcherRef.current, [fulfilledThenable]);
        Reflect.apply(use, dispatcherRef.current, [{ $$typeof: Symbol.for("react.recoverable") }]);
        return null;
      };

      const hooksTree = getFiberHooks(createFakeFiber(UseComponent));
      const allHooks: HooksNode[] = [];
      const visit = (hooks: HooksNode[]): void => {
        for (const hook of hooks) {
          allHooks.push(hook);
          visit(hook.subHooks);
        }
      };
      visit(hooksTree);
      const loadedHook = allHooks.find((hook) => hook.value === "loaded");
      expect(loadedHook?.debugInfo).toBe(debugInfo);
      expect(allHooks.some((hook) => hook !== loadedHook && hook.value === undefined)).toBe(true);
    } finally {
      _renderers.delete(renderer);
    }
  });
});
