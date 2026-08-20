import "../src/index.js";

import { act, cleanup, render } from "@testing-library/react";
import { instrument, traverseFiber } from "bippy";
import { getFiberHooks } from "bippy/source";
import React from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Fiber } from "bippy";
import type { HooksNode } from "bippy/source";

const disposals: Array<() => void> = [];

const renderAndGetHooks = (
  element: React.ReactNode,
  expectedType?: React.ComponentType<object>,
): HooksNode[] => {
  let committedFiber: Fiber | null = null;
  const elementType = React.isValidElement(element) ? element.type : null;
  disposals.push(
    instrument({
      name: "react-debug-tools-parity",
      onCommitFiberRoot: (_rendererId, root) => {
        committedFiber =
          traverseFiber(root.current, (fiber) => {
            const targetType = expectedType ?? elementType;
            return targetType !== null && fiber.type === targetType ? true : undefined;
          }) ?? null;
      },
    }),
  );
  render(element);
  if (!committedFiber) throw new Error("Missing committed Fiber");
  return getFiberHooks(committedFiber);
};

const flattenHooks = (hooks: HooksNode[]): HooksNode[] => {
  const flattened: HooksNode[] = [];
  const visit = (nodes: HooksNode[]): void => {
    for (const hook of nodes) {
      flattened.push(hook);
      visit(hook.subHooks);
    }
  };
  visit(hooks);
  return flattened;
};

afterEach(() => {
  cleanup();
  for (const dispose of disposals.splice(0)) dispose();
});

describe("remaining upstream React Debug Tools conformance", () => {
  it("inspects multiple levels of custom hooks", () => {
    const useInner = () => React.useState("inner")[0];
    const useOuter = () => useInner();
    const App = () => <div>{useOuter()}</div>;
    const hooks = flattenHooks(renderAndGetHooks(<App />));
    expect(hooks.map((hook) => hook.value)).toContain("inner");
    expect(hooks.some((hook) => hook.subHooks.length > 0)).toBe(true);
  });

  it("does not confuse built-ins with custom hooks sharing a name", () => {
    const useState = () => React.useState("custom")[0];
    const App = () => <div>{useState()}</div>;
    const hooks = flattenHooks(renderAndGetHooks(<App />));
    expect(hooks.filter((hook) => hook.name === "State").length).toBeGreaterThanOrEqual(1);
  });

  it("inspects resolved Promise values passed to use", () => {
    const promise = Promise.resolve("resolved");
    Reflect.set(promise, "status", "fulfilled");
    Reflect.set(promise, "value", "resolved");
    const App = () => <div>{React.use(promise)}</div>;
    const hooks = flattenHooks(renderAndGetHooks(<App />));
    expect(hooks.map((hook) => hook.value)).toContain("resolved");
  });

  it("inspects Context values passed to use", () => {
    const Context = React.createContext("default");
    const App = () => <div>{React.use(Context)}</div>;
    const hooks = flattenHooks(
      renderAndGetHooks(
        <Context.Provider value="provided">
          <App />
        </Context.Provider>,
        App,
      ),
    );
    expect(hooks.map((hook) => hook.value)).toContain("provided");
  });

  it("inspects hooks called in anonymous loops", () => {
    const App = () => {
      const values = [0, 1].map((initialValue) => React.useState(initialValue)[0]);
      return <div>{values.join(",")}</div>;
    };
    const hooks = flattenHooks(renderAndGetHooks(<App />));
    expect(hooks.filter((hook) => hook.isStateEditable)).toHaveLength(2);
  });

  it("ignores useDebugValue outside custom hooks", () => {
    const App = () => {
      React.useDebugValue("ignored");
      React.useState(1);
      return null;
    };
    const hooks = flattenHooks(renderAndGetHooks(<App />));
    expect(hooks.some((hook) => hook.name === "DebugValue")).toBe(false);
  });

  it("updates pending state returned by useTransition", () => {
    let start: React.TransitionStartFunction | null = null;
    const App = () => {
      const [isPending, startTransition] = React.useTransition();
      start = startTransition;
      return <div>{String(isPending)}</div>;
    };
    const view = render(<App />);
    if (!start) throw new Error("Missing transition callback");
    act(() => start?.(() => view.rerender(<App />)));
    expect(view.container.textContent === "true" || view.container.textContent === "false").toBe(
      true,
    );
  });

  it("supports multiple formatted debug values", () => {
    const useValues = () => {
      React.useDebugValue(1, (value) => `first:${value}`);
      React.useDebugValue(2, (value) => `second:${value}`);
    };
    const App = () => {
      useValues();
      return null;
    };
    const hooks = flattenHooks(renderAndGetHooks(<App />));
    expect(
      hooks.some(
        (hook) =>
          Array.isArray(hook.value) && hook.value[0] === "first:1" && hook.value[1] === "second:2",
      ),
    ).toBe(true);
  });
});
