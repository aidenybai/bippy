import { describe, expect, it } from "vite-plus/test";
import { ReactBuildType, type Fiber, type ReactRenderer } from "../src/react-internals/index.js";
import { _renderers } from "../src/rdt-hook.js";
import { getFiberHooks } from "../src/source/inspect-hooks.js";
import { latestReactWorkTags } from "./react-work-tags.js";

const createFakeFiber = (type: unknown): Fiber =>
  ({
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
      expect(hooksTree).toHaveLength(1);
      expect(hooksTree[0].subHooks).toHaveLength(2);
      const nativeHooks = hooksTree[0].subHooks.flatMap((hook) => hook.subHooks);
      expect(nativeHooks).toHaveLength(2);
      expect(nativeHooks[0].value).toBe("loaded");
      expect(nativeHooks[0].debugInfo).toBe(debugInfo);
      expect(nativeHooks[1].value).toBeUndefined();
    } finally {
      _renderers.delete(renderer);
    }
  });
});
