// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type * as React from "react";

import type { HarnessTools, Scenario } from "../harness";

interface CounterState {
  count: number;
}

const defineClassCounter = (
  tools: HarnessTools,
  color: string,
): React.ComponentType<object> => {
  const { React: ReactModule } = tools;
  class Hello extends ReactModule.Component<object, CounterState> {
    override state: CounterState = { count: 0 };
    handleClick = () => {
      this.setState((previous) => ({ count: previous.count + 1 }));
    };
    override render() {
      return (
        <p style={{ color }} onClick={this.handleClick}>
          {this.state.count}
        </p>
      );
    }
  }
  // For classes this registration happens at module boundaries rather than
  // via the Babel plugin; the remount must still use the latest version.
  tools.register(Hello, "Hello");
  return Hello;
};

export const classAndRefScenarios: Record<string, Scenario> = {
  "remounts classes on every edit": async (tools) => {
    const { render, patch, expect, firstElement, clickElement, container } = tools;

    const HelloV1 = await render(() => defineClassCounter(tools, "blue"));

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    const HelloV2 = await patch(() => defineClassCounter(tools, "red"));

    // Classes remount on every edit.
    expect(container.firstChild).not.toBe(element);
    const remountedElement = firstElement();
    expect(remountedElement.textContent).toBe("0");
    expect(remountedElement.style.color).toBe("red");
    await clickElement(remountedElement);
    expect(remountedElement.textContent).toBe("1");

    // Top-level renders of both types resolve to the latest.
    await render(() => HelloV1);
    await render(() => HelloV2);
    expect(container.firstChild).toBe(remountedElement);
    expect(remountedElement.style.color).toBe("red");
    expect(remountedElement.textContent).toBe("1");

    const HelloV3 = await patch(() => defineClassCounter(tools, "orange"));

    expect(container.firstChild).not.toBe(remountedElement);
    const finalElement = firstElement();
    expect(finalElement.textContent).toBe("0");
    expect(finalElement.style.color).toBe("orange");
    await clickElement(finalElement);
    expect(finalElement.textContent).toBe("1");

    await render(() => HelloV3);
    await render(() => HelloV2);
    await render(() => HelloV1);
    expect(container.firstChild).toBe(finalElement);
    expect(finalElement.style.color).toBe("orange");
    expect(finalElement.textContent).toBe("1");
  },

  "updates refs when remounting": async (tools) => {
    const { React: ReactModule, render, patch, expect } = tools;

    interface ColorHandle {
      getColor(): string;
    }

    const testRef = ReactModule.createRef<ColorHandle>();

    const defineClassWithColor = (color: string) => {
      class Hello extends ReactModule.Component {
        getColor() {
          return color;
        }
        override render() {
          return <p />;
        }
      }
      tools.register(Hello, "Hello");
      return Hello;
    };

    const defineImperativeHandleWithColor = (color: string) => {
      const Hello = ReactModule.forwardRef<ColorHandle>((_props, ref) => {
        ReactModule.useImperativeHandle(ref, () => ({
          getColor() {
            return color;
          },
        }));
        return <p />;
      });
      tools.register(Hello, "Hello");
      return Hello;
    };

    await render(() => defineClassWithColor("green"), { ref: testRef });
    expect(testRef.current?.getColor()).toBe("green");

    await patch(() => defineClassWithColor("orange"));
    expect(testRef.current?.getColor()).toBe("orange");

    await patch(() => defineImperativeHandleWithColor("pink"));
    expect(testRef.current?.getColor()).toBe("pink");

    await patch(() => defineImperativeHandleWithColor("yellow"));
    expect(testRef.current?.getColor()).toBe("yellow");

    await patch(() => defineImperativeHandleWithColor("yellow"));
    expect(testRef.current?.getColor()).toBe("yellow");
  },

  "remounts on conversion from class to function and back": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, clickElement, container } =
      tools;

    const defineFunctionCounter = (color: string) => {
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

    const HelloV1 = await render(() => defineFunctionCounter("blue"));

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    // Function -> class remounts.
    const HelloV2 = await patch(() => defineClassCounter(tools, "red"));

    expect(container.firstChild).not.toBe(element);
    const classElement = firstElement();
    expect(classElement.textContent).toBe("0");
    expect(classElement.style.color).toBe("red");
    await clickElement(classElement);
    expect(classElement.textContent).toBe("1");

    await render(() => HelloV1);
    await render(() => HelloV2);
    expect(container.firstChild).toBe(classElement);
    expect(classElement.style.color).toBe("red");
    expect(classElement.textContent).toBe("1");

    // Class -> function remounts again.
    const HelloV3 = await patch(() => defineFunctionCounter("orange"));

    expect(container.firstChild).not.toBe(classElement);
    const functionElement = firstElement();
    expect(functionElement.textContent).toBe("0");
    expect(functionElement.style.color).toBe("orange");
    await clickElement(functionElement);
    expect(functionElement.textContent).toBe("1");

    await render(() => HelloV3);
    await render(() => HelloV2);
    await render(() => HelloV1);
    expect(container.firstChild).toBe(functionElement);
    expect(functionElement.style.color).toBe("orange");
    expect(functionElement.textContent).toBe("1");

    // Now that it's a function again, edits keep state.
    await patch(() => defineFunctionCounter("purple"));
    expect(container.firstChild).toBe(functionElement);
    expect(functionElement.style.color).toBe("purple");
    expect(functionElement.textContent).toBe("1");
  },
};
