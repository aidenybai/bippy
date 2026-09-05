// @ts-nocheck
// HACK: Exact upstream fixture shapes are intentionally preserved without local type rewriting.
import "../src/index.js";

import React from "react";
import * as ReactTestRenderer from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import { getRDTHook } from "bippy";
import { getFiberHooks } from "bippy/source";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const ReactDebugTools = { inspectHooksOfFiber: getFiberHooks };
const act = ReactTestRenderer.act;
const __DEV__ = true;
const waitForAll = async () => Promise.resolve();
const rendererInternals = [...getRDTHook().renderers.values()].find(
  (renderer) => renderer.rendererPackageName === "react-test-renderer",
);
if (!rendererInternals) throw new Error("Missing React test renderer internals");
const overrideHookState = rendererInternals.overrideHookState;
const scheduleUpdate = rendererInternals.scheduleUpdate;
const scheduleRetry = rendererInternals.scheduleRetry;
const setSuspenseHandler = rendererInternals.setSuspenseHandler;

describe("React hooks DevTools integration", () => {
  it("should support editing useState hooks", async () => {
    let setCountFn;
    const MyComponent = () => {
      const [count, setCount] = React.useState(0);
      setCountFn = setCount;
      return <div>count:{count}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<MyComponent />, {
        unstable_isConcurrent: true,
      });
    });
    expect(renderer.toJSON()).toEqual({
      type: "div",
      props: {},
      children: ["count:", "0"],
    });
    const fiber = renderer.root.findByType(MyComponent)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(fiber);
    const stateHook = tree[0];
    expect(stateHook.isStateEditable).toBe(true);
    if (__DEV__) {
      await act(() => overrideHookState(fiber, stateHook.id, [], 10));
      expect(renderer.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["count:", "10"],
      });
      await act(() => setCountFn((count) => count + 1));
      expect(renderer.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["count:", "11"],
      });
    }
  });
  it("should support editable useReducer hooks", async () => {
    const initialData = {
      foo: "abc",
      bar: 123,
    };
    const reducer = (state, action) => {
      switch (action.type) {
        case "swap":
          return {
            foo: state.bar,
            bar: state.foo,
          };
        default:
          throw new Error();
      }
    };
    let dispatchFn;
    const MyComponent = () => {
      const [state, dispatch] = React.useReducer(reducer, initialData);
      dispatchFn = dispatch;
      return (
        <div>
          foo:{state.foo}, bar:{state.bar}
        </div>
      );
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<MyComponent />, {
        unstable_isConcurrent: true,
      });
    });
    expect(renderer.toJSON()).toEqual({
      type: "div",
      props: {},
      children: ["foo:", "abc", ", bar:", "123"],
    });
    const fiber = renderer.root.findByType(MyComponent)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(fiber);
    const reducerHook = tree[0];
    expect(reducerHook.isStateEditable).toBe(true);
    if (__DEV__) {
      await act(() => overrideHookState(fiber, reducerHook.id, ["foo"], "def"));
      expect(renderer.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["foo:", "def", ", bar:", "123"],
      });
      await act(() =>
        dispatchFn({
          type: "swap",
        }),
      );
      expect(renderer.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["foo:", "123", ", bar:", "def"],
      });
    }
  });
  it("should handle interleaved stateful hooks (e.g. useState) and non-stateful hooks (e.g. useContext)", async () => {
    const MyContext = React.createContext(1);
    let setStateFn;
    const useCustomHook = () => {
      const context = React.useContext(MyContext);
      const [state, setState] = React.useState({
        count: context,
      });
      React.useDebugValue(state.count);
      setStateFn = setState;
      return state.count;
    };
    const MyComponent = () => {
      const count = useCustomHook();
      return <div>count:{count}</div>;
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(<MyComponent />, {
        unstable_isConcurrent: true,
      });
    });
    expect(renderer.toJSON()).toEqual({
      type: "div",
      props: {},
      children: ["count:", "1"],
    });
    const fiber = renderer.root.findByType(MyComponent)._currentFiber();
    const tree = ReactDebugTools.inspectHooksOfFiber(fiber);
    const stateHook = tree[0].subHooks[1];
    expect(stateHook.isStateEditable).toBe(true);
    if (__DEV__) {
      await act(() => overrideHookState(fiber, stateHook.id, ["count"], 10));
      expect(renderer.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["count:", "10"],
      });
      await act(() =>
        setStateFn((state) => ({
          count: state.count + 1,
        })),
      );
      expect(renderer.toJSON()).toEqual({
        type: "div",
        props: {},
        children: ["count:", "11"],
      });
    }
  });
  it("should support overriding suspense in legacy mode", async () => {
    if (__DEV__) {
      setSuspenseHandler(() => true);
    }
    const MyComponent = () => {
      return "Done";
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <div>
          <React.Suspense fallback={"Loading"}>
            <MyComponent />
          </React.Suspense>
        </div>,
        {
          unstable_isConcurrent: true,
        },
      );
    });
    const fiber = renderer.root._currentFiber().child;
    if (__DEV__) {
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler(() => false);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
      setSuspenseHandler(() => true);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler(() => false);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
      setSuspenseHandler((f) => f === fiber || f === fiber.alternate);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler((f) => f !== fiber && f !== fiber.alternate);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
    } else {
      expect(renderer.toJSON().children).toEqual(["Done"]);
    }
  });
  it("should support overriding suspense in concurrent mode", async () => {
    if (__DEV__) {
      setSuspenseHandler(() => true);
    }
    const MyComponent = () => {
      return "Done";
    };
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <div>
          <React.Suspense fallback={"Loading"}>
            <MyComponent />
          </React.Suspense>
        </div>,
        { unstable_isConcurrent: true },
      );
    });
    await waitForAll([]);
    await Promise.resolve();
    const fiber = renderer.root._currentFiber().child;
    if (__DEV__) {
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler(() => false);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
      setSuspenseHandler(() => true);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler(() => false);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
      setSuspenseHandler((f) => f === fiber || f === fiber.alternate);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler((f) => f !== fiber && f !== fiber.alternate);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
    } else {
      expect(renderer.toJSON().children).toEqual(["Done"]);
    }
    if (scheduleRetry) {
      setSuspenseHandler(() => true);
      await act(() => scheduleUpdate(fiber));
      expect(renderer.toJSON().children).toEqual(["Loading"]);
      setSuspenseHandler(() => false);
      await act(() => scheduleRetry(fiber));
      expect(renderer.toJSON().children).toEqual(["Done"]);
    }
  });
});
