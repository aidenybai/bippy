// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type * as React from "react";

import type { Scenario } from "../harness";

export const hookAndRenderingScenarios: Record<string, Scenario> = {
  "resets hooks with dependencies on hot reload": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    let emptyArrayEffectCallCount = 0;

    await render(() => {
      const Hello = () => {
        const [value, setValue] = ReactModule.useState(0);
        const transformed = ReactModule.useMemo(() => value * 2, [value]);
        const handleClick = ReactModule.useCallback(() => setValue((previous) => previous + 1), []);
        ReactModule.useEffect(() => {
          emptyArrayEffectCallCount++;
        }, []);
        return (
          <p style={{ color: "blue" }} onClick={handleClick}>
            {transformed}
          </p>
        );
      };
      tools.register(Hello, "Hello");
      return Hello;
    });

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    expect(emptyArrayEffectCallCount).toBe(1);
    await clickElement(element);
    expect(element.textContent).toBe("2");
    expect(emptyArrayEffectCallCount).toBe(1);

    await patch(() => {
      const Hello = () => {
        const [value, setValue] = ReactModule.useState(0);
        const transformed = ReactModule.useMemo(() => value * 10, [value]);
        const handleClick = ReactModule.useCallback(() => setValue((previous) => previous - 1), []);
        ReactModule.useEffect(() => {
          emptyArrayEffectCallCount++;
        }, []);
        return (
          <p style={{ color: "red" }} onClick={handleClick}>
            {transformed}
          </p>
        );
      };
      tools.register(Hello, "Hello");
      return Hello;
    });

    // State preserved, but useMemo/useCallback/useEffect were reset.
    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("10");
    expect(element.style.color).toBe("red");
    expect(emptyArrayEffectCallCount).toBe(2);

    // The new callback decreases the counter.
    await clickElement(element);
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("red");
    expect(emptyArrayEffectCallCount).toBe(2);
  },

  // This pattern is inspired by useSubscription and similar mechanisms.
  "does not get into infinite loops during render phase updates": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, container } = tools;

    interface SourceState {
      value: number | null;
    }

    const defineHello = (sourceValue: number, color: string) => {
      const Hello = () => {
        const source = ReactModule.useMemo(() => ({ value: sourceValue }), []);
        const [state, setState] = ReactModule.useState<SourceState>({ value: null });
        if (state !== source) {
          // A single render-phase update, like useSubscription performs.
          setState(source);
        }
        return <p style={{ color }}>{state.value}</p>;
      };
      tools.register(Hello, "Hello");
      return Hello;
    };

    await render(() => defineHello(10, "blue"));

    const element = firstElement();
    expect(element.textContent).toBe("10");
    expect(element.style.color).toBe("blue");

    await patch(() => defineHello(20, "red"));

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("20");
    expect(element.style.color).toBe("red");
  },

  "does not re-render ancestor components unnecessarily during a hot update": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    let appRenderCount = 0;

    const defineHello = (color: string) => {
      const Hello = () => {
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

    await render(() => {
      const Hello = defineHello("blue");
      const App = () => {
        appRenderCount++;
        return <Hello />;
      };
      tools.register(App, "App");
      return App;
    });

    expect(appRenderCount).toBe(1);

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");
    expect(appRenderCount).toBe(1);

    // Hot update for Hello only.
    await patch(() => {
      defineHello("red");
    });

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");
    expect(appRenderCount).toBe(1);

    await clickElement(element);
    expect(element.textContent).toBe("2");
    expect(appRenderCount).toBe(1);
  },

  "batches re-renders during a hot update": async (tools) => {
    const { render, patch, expect, container } = tools;

    interface HelloProps {
      children?: React.ReactNode;
    }

    let helloRenderCount = 0;

    await render(() => {
      const Hello = ({ children }: HelloProps) => {
        helloRenderCount++;
        return <div>X{children}X</div>;
      };
      tools.register(Hello, "Hello");

      const App = () => (
        <Hello>
          <Hello>
            <Hello />
          </Hello>
          <Hello>
            <Hello />
          </Hello>
        </Hello>
      );
      return App;
    });
    expect(helloRenderCount).toBe(5);
    expect(container.textContent).toBe("XXXXXXXXXX");
    helloRenderCount = 0;

    await patch(() => {
      const Hello = ({ children }: HelloProps) => {
        helloRenderCount++;
        return <div>O{children}O</div>;
      };
      tools.register(Hello, "Hello");
    });
    // Each instance re-renders exactly once during the refresh.
    expect(helloRenderCount).toBe(5);
    expect(container.textContent).toBe("OOOOOOOOOO");
  },

  "double invokes effects after a forced remount in StrictMode": async (tools) => {
    const {
      React: ReactModule,
      renderElement,
      patch,
      expect,
      firstElement,
      log,
      assertLog,
    } = tools;

    const defineHelloV1 = () => {
      const Hello = () => {
        ReactModule.useEffect(() => {
          log.push("mount v1");
          return () => {
            log.push("unmount v1");
          };
        }, []);
        return <p style={{ color: "blue" }}>Hello</p>;
      };
      tools.register(Hello, "Hello");
      tools.setSignature(Hello, "1");
      return Hello;
    };

    const App = defineHelloV1();
    await renderElement(
      <ReactModule.StrictMode>
        <App />
      </ReactModule.StrictMode>,
    );

    assertLog(["mount v1", "unmount v1", "mount v1"]);

    await patch(() => {
      const Hello = () => {
        ReactModule.useEffect(() => {
          log.push("mount v2");
          return () => {
            log.push("unmount v2");
          };
        }, []);
        return <p style={{ color: "red" }}>Hello</p>;
      };
      tools.register(Hello, "Hello");
      tools.setSignature(Hello, "2");
      return null;
    });

    expect(firstElement().style.color).toBe("red");
    assertLog(["unmount v1", "mount v2", "unmount v2", "mount v2"]);
  },

  "double invokes an effect added during a Fast Refresh remount in StrictMode": async (tools) => {
    const {
      React: ReactModule,
      renderElement,
      patch,
      expect,
      firstElement,
      log,
      assertLog,
    } = tools;

    const defineHelloV1 = () => {
      const Hello = () => <p style={{ color: "blue" }}>Hello</p>;
      tools.register(Hello, "Hello");
      tools.setSignature(Hello, "1");
      return Hello;
    };

    const App = defineHelloV1();
    await renderElement(
      <ReactModule.StrictMode>
        <App />
      </ReactModule.StrictMode>,
    );

    assertLog([]);

    await patch(() => {
      const Hello = () => {
        ReactModule.useEffect(() => {
          log.push("mount v2");
          return () => {
            log.push("unmount v2");
          };
        }, []);
        return <p style={{ color: "red" }}>Hello</p>;
      };
      tools.register(Hello, "Hello");
      tools.setSignature(Hello, "2");
      return null;
    });

    expect(firstElement().style.color).toBe("red");
    assertLog(["mount v2", "unmount v2", "mount v2"]);
  },
};
