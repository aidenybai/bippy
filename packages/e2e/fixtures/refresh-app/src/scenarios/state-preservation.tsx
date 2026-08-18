// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type * as React from "react";

import type { HarnessTools, Scenario } from "../harness";

interface CounterVersionFactory {
  (color: string): React.ComponentType<object>;
}

const createCounter = (tools: HarnessTools, color: string): React.ComponentType<object> => {
  const { React: ReactModule } = tools;
  const Hello = () => {
    const [value, setValue] = ReactModule.useState(0);
    return (
      <p style={{ color }} onClick={() => setValue(value + 1)}>
        {value}
      </p>
    );
  };
  return Hello;
};

// The original suite repeats one skeleton across wrapper kinds: render v1
// (blue), bump state, hot-update to v2 (red) asserting the DOM node and
// state survive, re-render stale and fresh types asserting stability, then
// render an incompatible type asserting a full remount.
const runPreservationCycle = async (
  tools: HarnessTools,
  defineVersion: CounterVersionFactory,
  defineIncompatible: () => React.ComponentType<object>,
): Promise<void> => {
  const { render, patch, expect, firstElement, clickElement, container } = tools;

  const OuterV1 = await render(() => defineVersion("blue"));

  const element = firstElement();
  expect(element.textContent).toBe("0");
  expect(element.style.color).toBe("blue");
  await clickElement(element);
  expect(element.textContent).toBe("1");

  const OuterV2 = await patch(() => defineVersion("red"));

  expect(container.firstChild).toBe(element);
  expect(element.textContent).toBe("1");
  expect(element.style.color).toBe("red");

  await clickElement(element);
  expect(container.firstChild).toBe(element);
  expect(element.textContent).toBe("2");
  expect(element.style.color).toBe("red");

  // Top-down renders with fresh and stale types must resolve to the latest
  // version without touching state or styling.
  await render(() => OuterV1);
  await render(() => OuterV2);
  await render(() => OuterV1);
  expect(container.firstChild).toBe(element);
  expect(element.textContent).toBe("2");
  expect(element.style.color).toBe("red");

  await render(defineIncompatible);
  expect(container.firstChild).not.toBe(element);
  const remountedElement = firstElement();
  expect(remountedElement.textContent).toBe("0");
  expect(remountedElement.style.color).toBe("blue");
};

const defineUnregisteredCounter = (tools: HarnessTools) => () => createCounter(tools, "blue");

const defineRegisteredBareCounter = (tools: HarnessTools) => () => {
  const Hello = createCounter(tools, "blue");
  tools.register(Hello, "Hello");
  return Hello;
};

export const statePreservationScenarios: Record<string, Scenario> = {
  "preserves state for compatible types": async (tools) => {
    await runPreservationCycle(
      tools,
      (color) => {
        const Hello = createCounter(tools, color);
        tools.register(Hello, "Hello");
        return Hello;
      },
      // No register call, so this is considered a new type.
      defineUnregisteredCounter(tools),
    );
  },

  "preserves state for forwardRef": async (tools) => {
    await runPreservationCycle(
      tools,
      (color) => {
        const Hello = createCounter(tools, color);
        tools.register(Hello, "Hello");
        const Outer = tools.React.forwardRef(() => <Hello />);
        tools.register(Outer, "Outer");
        return Outer;
      },
      // No forwardRef wrapper this time, so the type is incompatible.
      defineRegisteredBareCounter(tools),
    );
  },

  "preserves state for simple memo": async (tools) => {
    await runPreservationCycle(
      tools,
      (color) => {
        const Hello = createCounter(tools, color);
        tools.register(Hello, "Hello");
        const Outer = tools.React.memo(Hello);
        tools.register(Outer, "Outer");
        return Outer;
      },
      defineRegisteredBareCounter(tools),
    );
  },

  "preserves state for memo with custom comparison": async (tools) => {
    await runPreservationCycle(
      tools,
      (color) => {
        // The inner function is intentionally not registered; only the memo
        // wrapper carries the family.
        const Outer = tools.React.memo(createCounter(tools, color), () => true);
        tools.register(Outer, "Outer");
        return Outer;
      },
      defineRegisteredBareCounter(tools),
    );
  },

  "preserves state for memo(forwardRef)": async (tools) => {
    await runPreservationCycle(
      tools,
      (color) => {
        const Hello = createCounter(tools, color);
        tools.register(Hello, "Hello");
        const Outer = tools.React.memo(tools.React.forwardRef(() => <Hello />));
        tools.register(Outer, "Outer");
        return Outer;
      },
      defineRegisteredBareCounter(tools),
    );
  },

  "does not consider two forwardRefs around the same type equivalent": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    interface ParentProps {
      cond: boolean;
    }

    const defineParent = (color: string) => {
      const Hello = createCounter(tools, color);
      tools.register(Hello, "Hello");

      const renderInner = () => <Hello />;
      // Both wrappers share the inner function but must be treated as
      // distinct types across reloads.
      const ForwardRefA = ReactModule.forwardRef(renderInner);
      tools.register(ForwardRefA, "ForwardRefA");
      const ForwardRefB = ReactModule.forwardRef(renderInner);
      tools.register(ForwardRefB, "ForwardRefB");

      const Parent = ({ cond }: ParentProps) => (cond ? <ForwardRefA /> : <ForwardRefB />);
      tools.register(Parent, "Parent");
      return Parent;
    };

    const ParentV1 = await render<ParentProps>(() => defineParent("blue"), { cond: true });

    let element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    // Switching the inner wrapper type resets state.
    await render(() => ParentV1, { cond: false });
    expect(container.firstChild).not.toBe(element);
    element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");

    await clickElement(element);
    expect(element.textContent).toBe("1");

    await render(() => ParentV1, { cond: true });
    expect(container.firstChild).not.toBe(element);
    element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");

    await clickElement(element);
    expect(element.textContent).toBe("1");

    const ParentV2 = await patch(() => defineParent("red"));

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");

    await render(() => ParentV2, { cond: false });
    expect(container.firstChild).not.toBe(element);
    element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("red");

    await clickElement(element);
    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");

    await render(() => ParentV1);
    await render(() => ParentV2);
    await render(() => ParentV1);
    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");
  },

  "updates forwardRef render function together with its wrapper": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    interface ColoredProps {
      color: string;
    }

    const defineVersion = (color: string) => {
      const Hello = ({ color: innerColor }: ColoredProps) => {
        const [value, setValue] = ReactModule.useState(0);
        return (
          <p style={{ color: innerColor }} onClick={() => setValue(value + 1)}>
            {value}
          </p>
        );
      };
      tools.register(Hello, "Hello");
      const Outer = ReactModule.forwardRef(() => <Hello color={color} />);
      tools.register(Outer, "Outer");
      return Outer;
    };

    await render(() => defineVersion("blue"));

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    await patch(() => defineVersion("red"));

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");
  },

  "updates forwardRef render function in isolation": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    interface ColoredProps {
      color: string;
    }

    const defineHello = () => {
      const Hello = ({ color }: ColoredProps) => {
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
      const Hello = defineHello();
      const renderHello = () => <Hello color="blue" />;
      tools.register(renderHello, "renderHello");
      return ReactModule.forwardRef(renderHello);
    });

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    // Hot update of just the render function, without the wrapper.
    await patch(() => {
      const Hello = defineHello();
      const renderHello = () => <Hello color="red" />;
      tools.register(renderHello, "renderHello");
    });

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");
  },

  "updates simple memo function in isolation": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    await render(() => {
      const Hello = createCounter(tools, "blue");
      tools.register(Hello, "Hello");
      return ReactModule.memo(Hello);
    });

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    // Hot update of just the inner function, not the memo wrapper.
    await patch(() => {
      const Hello = createCounter(tools, "red");
      tools.register(Hello, "Hello");
    });

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");
  },

  "resets state when switching between different component types": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, clickElement } = tools;

    await render(() => {
      const Test = () => {
        const [count, setCount] = ReactModule.useState(0);
        return <div onClick={() => setCount((previous) => previous + 1)}>count: {count}</div>;
      };
      tools.register(Test, "Test");
      return Test;
    });

    expect(firstElement().textContent).toBe("count: 0");
    await clickElement(firstElement());
    expect(firstElement().textContent).toBe("count: 1");

    // Function -> memo: remounts with fresh state.
    await patch(() => {
      const Test2 = () => {
        const [count, setCount] = ReactModule.useState(0);
        return <div onClick={() => setCount((previous) => previous + 1)}>count: {count}</div>;
      };
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test2");
      tools.register(Test, "Test");
      return Test;
    });

    expect(firstElement().textContent).toBe("count: 0");
    await clickElement(firstElement());
    expect(firstElement().textContent).toBe("count: 1");

    // memo -> forwardRef: remounts again with fresh state.
    await patch(() => {
      const Test = ReactModule.forwardRef<HTMLDivElement>((_props, ref) => {
        const [count, setCount] = ReactModule.useState(0);
        const divRef = ReactModule.useRef<HTMLDivElement | null>(null);
        ReactModule.useEffect(() => {
          if (typeof ref === "function") {
            ref(divRef.current);
          } else if (ref && Object.isExtensible(ref)) {
            ref.current = divRef.current;
          }
        }, [ref]);
        return (
          <div ref={divRef} onClick={() => setCount((previous) => previous + 1)}>
            count: {count}
          </div>
        );
      });
      tools.register(Test, "Test");
      return Test;
    });

    expect(firstElement().textContent).toBe("count: 0");
    await clickElement(firstElement());
    expect(firstElement().textContent).toBe("count: 1");
  },

  "does not leak state between components": async (tools) => {
    const { render, patch, expect, firstElement, clickElement, container } = tools;

    interface AppProps {
      cond: boolean;
    }

    const defineApp = (color: string): React.ComponentType<AppProps> => {
      const Hello1 = createCounter(tools, color);
      tools.register(Hello1, "Hello1");
      const Hello2 = createCounter(tools, color);
      tools.register(Hello2, "Hello2");
      const App = ({ cond }: AppProps) => (cond ? <Hello1 /> : <Hello2 />);
      tools.register(App, "App");
      return App;
    };

    const AppV1 = await render<AppProps>(() => defineApp("blue"), { cond: false });

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    // Flipping the condition swaps the inner component and resets state.
    await render(() => AppV1, { cond: true });
    const secondElement = firstElement();
    expect(secondElement).not.toBe(element);
    expect(secondElement.textContent).toBe("0");
    expect(secondElement.style.color).toBe("blue");

    await clickElement(secondElement);
    expect(secondElement.textContent).toBe("1");

    // Hot update both inner components; state is preserved, color changes.
    await patch(() => defineApp("red"));
    expect(container.firstChild).toBe(secondElement);
    expect(secondElement.textContent).toBe("1");
    expect(secondElement.style.color).toBe("red");

    // Flipping again still resets state (no leak from the other family).
    await render(() => AppV1, { cond: false });
    const thirdElement = firstElement();
    expect(thirdElement).not.toBe(secondElement);
    expect(thirdElement.textContent).toBe("0");
    expect(thirdElement.style.color).toBe("red");
  },
};
