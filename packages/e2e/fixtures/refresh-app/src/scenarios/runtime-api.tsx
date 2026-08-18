// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type { ReactRenderer } from "bippy";

import type { Scenario } from "../harness";

export const runtimeApiScenarios: Record<string, Scenario> = {
  "can update multiple roots independently": async (tools) => {
    const { React: ReactModule, ReactFreshRuntime, act, expect, createExtraRoot } = tools;

    interface HelloProps {
      id?: number;
    }

    const defineHello = (color: string) => {
      const Hello = (_props: HelloProps) => {
        const [value, setValue] = ReactModule.useState(0);
        return (
          <p style={{ color }} onClick={() => setValue(value + 1)}>
            {value}
          </p>
        );
      };
      tools.register(Hello, "Hello");
      return Hello;
    };

    const getFirstElement = (rootContainer: HTMLDivElement): HTMLElement => {
      const element = rootContainer.firstChild;
      if (!(element instanceof HTMLElement)) {
        throw new Error("expected root container to have an element child");
      }
      return element;
    };

    // Declare the first version, then hot update before any roots exist.
    const HelloV1 = defineHello("blue");
    const HelloV2 = defineHello("red");
    await act(() => {
      ReactFreshRuntime.performReactRefresh();
    });

    const first = createExtraRoot();
    const second = createExtraRoot();
    const third = createExtraRoot();

    await act(() => {
      first.root.render(<HelloV1 id={1} />);
    });
    await act(() => {
      second.root.render(<HelloV2 id={2} />);
    });
    await act(() => {
      third.root.render(<HelloV1 id={3} />);
    });

    // All roots resolve to the V2 color.
    for (const { container: rootContainer } of [first, second, third]) {
      expect(getFirstElement(rootContainer).style.color).toBe("red");
      expect(getFirstElement(rootContainer).textContent).toBe("0");
    }

    await act(() => {
      for (const { container: rootContainer } of [first, second, third]) {
        getFirstElement(rootContainer).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });
    for (const { container: rootContainer } of [first, second, third]) {
      expect(getFirstElement(rootContainer).style.color).toBe("red");
      expect(getFirstElement(rootContainer).textContent).toBe("1");
    }

    // Another hot update affects all roots, preserving state.
    defineHello("green");
    await act(() => {
      ReactFreshRuntime.performReactRefresh();
    });
    for (const { container: rootContainer } of [first, second, third]) {
      expect(getFirstElement(rootContainer).style.color).toBe("green");
      expect(getFirstElement(rootContainer).textContent).toBe("1");
    }

    // Unmount the second root, then make the first root throw on update.
    await act(() => {
      second.root.unmount();
    });
    const HelloV4 = ({ id }: HelloProps) => {
      if (id === 1) {
        throw new Error("Oops.");
      }
      const [value, setValue] = ReactModule.useState(0);
      return (
        <p style={{ color: "orange" }} onClick={() => setValue(value + 1)}>
          {value}
        </p>
      );
    };
    tools.register(HelloV4, "Hello");
    let thrownMessage: string | null = null;
    try {
      await act(() => {
        ReactFreshRuntime.performReactRefresh();
      });
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error);
    }
    expect(thrownMessage).toBe("Oops.");

    // The last root is still updated despite the first one failing.
    expect(first.container.innerHTML).toBe("");
    expect(second.container.innerHTML).toBe("");
    expect(getFirstElement(third.container).style.color).toBe("orange");
    expect(getFirstElement(third.container).textContent).toBe("1");
  },

  // Module runtimes use this to decide whether to propagate an update up to
  // importing modules or stop at the current module. Not 100% precise.
  "can detect likely component types": async (tools) => {
    const { React: ReactModule, ReactFreshRuntime, expect, renderElement } = tools;
    const { isLikelyComponentType } = ReactFreshRuntime;

    expect(isLikelyComponentType(false)).toBe(false);
    expect(isLikelyComponentType(null)).toBe(false);
    expect(isLikelyComponentType("foo")).toBe(false);

    // Conservative on plain functions so edits to non-component modules
    // still propagate to a proper reload.
    expect(isLikelyComponentType(() => {})).toBe(false);
    const lightenColor = function lightenColor() {};
    expect(isLikelyComponentType(lightenColor)).toBe(false);
    const loadUser = () => {};
    expect(isLikelyComponentType(loadUser)).toBe(false);
    const useStore = () => {};
    expect(isLikelyComponentType(useStore)).toBe(false);
    const useTheme = function useTheme() {};
    expect(isLikelyComponentType(useTheme)).toBe(false);
    const rogueProxy = new Proxy(
      {},
      {
        get() {
          throw new Error();
        },
      },
    );
    expect(isLikelyComponentType(rogueProxy)).toBe(false);

    // These seem like function components.
    const Button = () => {};
    expect(isLikelyComponentType(Button)).toBe(true);
    const Widget = function Widget() {};
    expect(isLikelyComponentType(Widget)).toBe(true);
    const ProxyButton = new Proxy(Button, {
      get(target, property) {
        return Reflect.get(target, property);
      },
    });
    expect(isLikelyComponentType(ProxyButton)).toBe(true);
    const anonymous = (() => () => {})();
    Object.assign(anonymous, { displayName: "Foo" });
    expect(isLikelyComponentType(anonymous)).toBe(true);

    // These seem like class components.
    class Btn extends ReactModule.Component {}
    class PureBtn extends ReactModule.PureComponent {}
    const ProxyBtn = new Proxy(Btn, {
      get(target, property) {
        return Reflect.get(target, property);
      },
    });
    expect(isLikelyComponentType(Btn)).toBe(true);
    expect(isLikelyComponentType(PureBtn)).toBe(true);
    expect(isLikelyComponentType(ProxyBtn)).toBe(true);

    // These don't.
    class Figure {
      move() {}
    }
    expect(isLikelyComponentType(Figure)).toBe(false);
    class Point extends Figure {}
    expect(isLikelyComponentType(Point)).toBe(false);

    // A commit so the shared bippy assertion has something to observe.
    await renderElement(<p>done</p>);
  },

  "reports updated and remounted families to the caller": async (tools) => {
    const { React: ReactModule, ReactFreshRuntime, expect, renderElement } = tools;

    const HelloV1 = () => {
      const [value, setValue] = ReactModule.useState(0);
      return (
        <p style={{ color: "blue" }} onClick={() => setValue(value + 1)}>
          {value}
        </p>
      );
    };
    tools.register(HelloV1, "Hello");

    const HelloV2 = () => {
      const [value, setValue] = ReactModule.useState(0);
      return (
        <p style={{ color: "red" }} onClick={() => setValue(value + 1)}>
          {value}
        </p>
      );
    };
    tools.register(HelloV2, "Hello");

    const update = ReactFreshRuntime.performReactRefresh();
    if (!update) {
      throw new Error("expected performReactRefresh to report an update");
    }
    expect(update.updatedFamilies.size).toBe(1);
    expect(update.staleFamilies.size).toBe(0);
    const family = update.updatedFamilies.values().next().value;
    const familyCurrent =
      family && typeof family === "object" ? Reflect.get(family, "current") : null;
    const familyName = typeof familyCurrent === "function" ? familyCurrent.name : null;
    expect(familyName).toBe("HelloV2");

    await renderElement(<p>done</p>);
  },

  // Adaptation of the react-refresh regression for facebook/react#20100:
  // renderers that predate Fast Refresh (no scheduleRefresh/setRefreshHandler)
  // must not break the hook chain for DevTools, bippy, or later refreshes.
  "does not break when an unsupported legacy renderer is injected": async (tools) => {
    const { render, patch, expect, firstElement, clickElement, container } = tools;

    const rdtHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!rdtHook) {
      throw new Error("expected the DevTools hook to be installed");
    }
    const legacyRenderer: ReactRenderer = {
      bundleType: 1,
      rendererPackageName: "react-dom",
      version: "16.8.0",
    };
    const legacyRendererId = rdtHook.inject(legacyRenderer);
    if (typeof legacyRendererId !== "number") {
      throw new Error("expected inject to return a renderer id");
    }
    expect(rdtHook.renderers.get(legacyRendererId)).toBe(legacyRenderer);

    // Fast Refresh must keep working for the modern renderer on the page.
    await render(() => {
      const Hello = () => {
        const [value, setValue] = tools.React.useState(0);
        return (
          <p style={{ color: "blue" }} onClick={() => setValue(value + 1)}>
            {value}
          </p>
        );
      };
      tools.register(Hello, "Hello");
      return Hello;
    });

    const element = firstElement();
    await clickElement(element);
    expect(element.textContent).toBe("1");

    await patch(() => {
      const Hello = () => {
        const [value, setValue] = tools.React.useState(0);
        return (
          <p style={{ color: "red" }} onClick={() => setValue(value + 1)}>
            {value}
          </p>
        );
      };
      tools.register(Hello, "Hello");
    });

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");
  },
};
