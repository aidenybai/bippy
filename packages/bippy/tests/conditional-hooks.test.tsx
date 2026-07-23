import { installConditionalHooks, type ConditionalHooksOptions } from "../src/index.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const installations: Array<ReturnType<typeof installConditionalHooks>> = [];

interface CounterProperties {
  name: string;
}

const install = (options?: ConditionalHooksOptions): ReturnType<typeof installConditionalHooks> => {
  const installation = installConditionalHooks(options);
  installations.push(installation);
  return installation;
};

afterEach(() => {
  cleanup();
  for (const installation of installations.splice(0)) installation();
});

describe("conditional hooks", () => {
  it("makes ordinary React hooks conditional through the dispatcher proxy", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      const [isEnabled, setIsEnabled] = React.useState(false);
      let conditionalContent: React.ReactNode = "disabled";
      if (isEnabled) {
        const [count, setCount] = React.useState(0);
        React.useEffect(() => {
          events.push("start");
          return () => events.push("stop");
        }, []);
        conditionalContent = (
          <button onClick={() => setCount((value) => value + 1)}>{count}</button>
        );
      }
      return (
        <div>
          <button onClick={() => setIsEnabled((value) => !value)}>toggle</button>
          <span data-testid="content">{conditionalContent}</span>
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(events).toEqual(["start"]));
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
    fireEvent.click(screen.getByText("toggle"));
    expect(events).toEqual(["start", "stop"]);
    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
  });

  it("reuses intercepted callsite keys across Strict Mode render replays", async () => {
    install();
    const initializeState = vi.fn(() => 0);

    const Component = (): React.ReactNode => {
      const [count, setCount] = React.useState(initializeState);
      return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    expect(initializeState).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
  });

  it("retains conditional state while its branch is disabled", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [isEnabled, setIsEnabled] = React.useState(false);
      let conditionalContent: React.ReactNode = <span data-testid="value">disabled</span>;

      if (isEnabled) {
        const [count, setCount] = React.useState(0);
        conditionalContent = (
          <button data-testid="value" onClick={() => setCount((value) => value + 1)}>
            {count}
          </button>
        );
      }

      return (
        <div>
          <button onClick={() => setIsEnabled((value) => !value)}>toggle</button>
          {conditionalContent}
        </div>
      );
    };

    render(<Component />);
    expect(screen.getByTestId("value").textContent).toBe("disabled");
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("value").textContent).toBe("0");
    fireEvent.click(screen.getByTestId("value"));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("1"));
    fireEvent.click(screen.getByText("toggle"));
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("value").textContent).toBe("1");
  });

  it("isolates identical callsites between component instances", async () => {
    install();

    const Counter = ({ name }: CounterProperties): React.ReactNode => {
      const [count, setCount] = React.useState(0);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          {name}:{count}
        </button>
      );
    };

    render(
      <>
        <Counter name="first" />
        <Counter name="second" />
      </>,
    );
    fireEvent.click(screen.getByText("first:0"));
    await waitFor(() => expect(screen.getByText("first:1")).toBeDefined());
    expect(screen.getByText("second:0")).toBeDefined();
  });

  it("supports reducer, ref, and memo cells in a conditional branch", async () => {
    install();
    const createMemo = vi.fn((value: number) => value * 2);

    const Component = (): React.ReactNode => {
      const [count, dispatch] = React.useReducer(
        (state: number, amount: number) => state + amount,
        1,
      );
      const renderCount = React.useRef(0);
      renderCount.current++;
      const doubled = React.useMemo(() => createMemo(count), [count]);
      return (
        <button onClick={() => dispatch(2)}>
          {count}:{doubled}:{renderCount.current}
        </button>
      );
    };

    render(<Component />);
    expect(screen.getByRole("button").textContent).toBe("1:2:1");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button").textContent).toBe("3:6:2"));
    expect(createMemo).toHaveBeenCalledTimes(2);
  });

  it("runs and cleans up effects as branches appear and disappear", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      const [isEnabled, setIsEnabled] = React.useState(false);
      if (isEnabled) {
        React.useEffect(() => {
          events.push("start");
          return () => events.push("stop");
        }, []);
      }
      return <button onClick={() => setIsEnabled((value) => !value)}>toggle</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("toggle"));
    await waitFor(() => expect(events).toEqual(["start"]));
    fireEvent.click(screen.getByText("toggle"));
    expect(events).toEqual(["start", "stop"]);
  });
});
