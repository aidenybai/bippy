import {
  installConditionalHooks,
  type ConditionalHooksOptions,
  useConditionalEffect,
  useConditionalLayoutEffect,
  useConditionalMemo,
  useConditionalState,
} from "../src/index.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

interface EffectChildProperties {
  name: string;
}

interface MemoRollbackProperties {
  shouldSuspend: boolean;
  value: number;
}

interface SignalProperties {
  signal: boolean;
}

interface SuspenseContentProperties {
  shouldSuspend: boolean;
}

const installations: Array<ReturnType<typeof installConditionalHooks>> = [];

const install = (options?: ConditionalHooksOptions): ReturnType<typeof installConditionalHooks> => {
  const installation = installConditionalHooks(options);
  installations.push(installation);
  return installation;
};

const createDeferred = <Value,>(): Deferred<Value> => {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  if (!resolvePromise) throw new Error("Deferred resolver was not initialized.");
  return { promise, resolve: resolvePromise };
};

afterEach(() => {
  cleanup();
  for (const installation of installations.splice(0)) installation();
});

describe("conditional hook adversarial cases", () => {
  it("matches native Strict Mode state initializer replay", () => {
    const nativeInitialize = vi.fn(() => 0);
    const NativeComponent = (): React.ReactNode => {
      React.useState(nativeInitialize);
      return null;
    };
    const nativeRendered = render(
      <React.StrictMode>
        <NativeComponent />
      </React.StrictMode>,
    );
    nativeRendered.unmount();

    install();
    const conditionalInitialize = vi.fn(() => 0);
    const ConditionalComponent = (): React.ReactNode => {
      useConditionalState("state", conditionalInitialize);
      return null;
    };
    render(
      <React.StrictMode>
        <ConditionalComponent />
      </React.StrictMode>,
    );

    expect(conditionalInitialize).toHaveBeenCalledTimes(nativeInitialize.mock.calls.length);
  });

  it("matches native Strict Mode passive effect replay", async () => {
    const nativeEvents: string[] = [];
    const NativeComponent = (): React.ReactNode => {
      React.useEffect(() => {
        nativeEvents.push("mount");
        return () => nativeEvents.push("cleanup");
      }, []);
      return null;
    };
    const nativeRendered = render(
      <React.StrictMode>
        <NativeComponent />
      </React.StrictMode>,
    );
    await waitFor(() => expect(nativeEvents).toEqual(["mount", "cleanup", "mount"]));
    nativeRendered.unmount();

    install();
    const conditionalEvents: string[] = [];
    const ConditionalComponent = (): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          conditionalEvents.push("mount");
          return () => conditionalEvents.push("cleanup");
        },
        [],
      );
      return null;
    };
    render(
      <React.StrictMode>
        <ConditionalComponent />
      </React.StrictMode>,
    );

    await waitFor(() => expect(conditionalEvents).toEqual(nativeEvents.slice(0, 3)));
  });

  it("converges render-phase state updates", async () => {
    install();
    const renders: number[] = [];

    const Component = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      renders.push(count);
      if (count < 3) setCount(count + 1);
      return <span>{count}</span>;
    };

    render(<Component />);
    await waitFor(() => expect(screen.getByText("3")).toBeDefined());
    expect(renders).toEqual([0, 1, 2, 3]);
  });

  it("discards render-phase updates from a suspended attempt", async () => {
    install();
    const deferred = createDeferred<void>();
    const events: string[] = [];

    const Component = ({ signal }: SignalProperties): React.ReactNode => {
      const [counter, setCounter] = useConditionalState("counter", 0);
      const [previousSignal, setPreviousSignal] = useConditionalState("signal", true);
      if (previousSignal !== signal) {
        setCounter((value) => value + 1);
        setPreviousSignal(signal);
        if (counter === 0) {
          events.push("suspend");
          throw deferred.promise;
        }
      }
      return <span>{counter}</span>;
    };

    const rendered = render(
      <React.Suspense fallback={<span>loading</span>}>
        <Component signal />
      </React.Suspense>,
    );
    expect(screen.getByText("0")).toBeDefined();

    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Component signal={false} />
      </React.Suspense>,
    );
    expect(screen.getByText("loading")).toBeDefined();

    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Component signal={false} />
      </React.Suspense>,
    );
    const attemptsAfterFirstSuspension = events.length;
    expect(attemptsAfterFirstSuspension).toBeGreaterThan(0);
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Component signal={false} />
      </React.Suspense>,
    );
    expect(events.length).toBeGreaterThan(attemptsAfterFirstSuspension);
    expect(screen.getByText("loading")).toBeDefined();
  });

  it("rolls memo cells back when a render suspends", () => {
    install();
    const computedValues: number[] = [];
    const deferred = createDeferred<void>();

    const Component = ({ shouldSuspend, value }: MemoRollbackProperties): React.ReactNode => {
      const memoized = useConditionalMemo(
        "memo",
        () => {
          computedValues.push(value);
          return value;
        },
        [value],
      );
      if (shouldSuspend) throw deferred.promise;
      return <span>{memoized}</span>;
    };

    const rendered = render(
      <React.Suspense fallback={<span>loading</span>}>
        <Component shouldSuspend={false} value={0} />
      </React.Suspense>,
    );
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Component shouldSuspend value={1} />
      </React.Suspense>,
    );
    expect(screen.getByText("loading")).toBeDefined();
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Component shouldSuspend={false} value={0} />
      </React.Suspense>,
    );

    expect(computedValues.filter((value) => value === 0)).toEqual([0]);
    expect(computedValues.every((value) => value === 0 || value === 1)).toBe(true);
  });

  it("disconnects and reconnects layout effects when Suspense hides content", async () => {
    install();
    const deferred = createDeferred<void>();
    const events: string[] = [];
    let didResolve = false;

    const Child = (): React.ReactNode => {
      useConditionalLayoutEffect(
        "layout",
        () => {
          events.push("mount");
          return () => events.push("cleanup");
        },
        [],
      );
      return <span>child</span>;
    };
    const SuspenseContent = ({ shouldSuspend }: SuspenseContentProperties): React.ReactNode => {
      return (
        <>
          <Child />
          {shouldSuspend && !didResolve
            ? (() => {
                throw deferred.promise;
              })()
            : null}
        </>
      );
    };

    const rendered = render(
      <React.Suspense fallback={<span>loading</span>}>
        <SuspenseContent shouldSuspend={false} />
      </React.Suspense>,
    );
    expect(events).toEqual(["mount"]);
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <SuspenseContent shouldSuspend />
      </React.Suspense>,
    );
    expect(events).toEqual(["mount", "cleanup"]);

    await act(async () => {
      didResolve = true;
      deferred.resolve();
      await deferred.promise;
    });
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <SuspenseContent shouldSuspend={false} />
      </React.Suspense>,
    );
    expect(events).toEqual(["mount", "cleanup", "mount"]);
  });

  it("updates a memoized component from its conditional setter", async () => {
    install();

    const Counter = React.memo((): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
    });

    render(<Counter />);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
  });

  it("tracks provider updates through intercepted useContext", async () => {
    install({ interceptReactHooks: true });
    const ValueContext = React.createContext("first");

    const Child = React.memo((): React.ReactNode => {
      const value = React.useContext(ValueContext);
      return <span>{value}</span>;
    });
    const Component = (): React.ReactNode => {
      const [value, setValue] = React.useState("first");
      return (
        <ValueContext.Provider value={value}>
          <button onClick={() => setValue("second")}>update</button>
          <Child />
        </ValueContext.Provider>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("update"));
    await waitFor(() => expect(screen.getByText("second")).toBeDefined());
  });

  it("does not clean effects on retained siblings after deletion and reorder", async () => {
    install();
    const events: string[] = [];

    const Child = ({ name }: EffectChildProperties): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          events.push(`mount:${name}`);
          return () => events.push(`cleanup:${name}`);
        },
        [],
      );
      return <span>{name}</span>;
    };

    const rendered = render(
      <>
        <Child key="first" name="first" />
        <Child key="second" name="second" />
      </>,
    );
    await waitFor(() => expect(events).toEqual(["mount:first", "mount:second"]));
    rendered.rerender(<Child key="second" name="second" />);
    expect(events).toEqual(["mount:first", "mount:second", "cleanup:first"]);
    rendered.unmount();
    expect(events).toEqual(["mount:first", "mount:second", "cleanup:first", "cleanup:second"]);
  });

  it("isolates identical explicit keys across separate roots", async () => {
    install();

    const Counter = ({ name }: EffectChildProperties): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          {name}:{count}
        </button>
      );
    };

    const firstRoot = render(<Counter name="first" />);
    const secondRoot = render(<Counter name="second" />);
    fireEvent.click(screen.getByText("first:0"));
    await waitFor(() => expect(screen.getByText("first:1")).toBeDefined());
    expect(screen.getByText("second:0")).toBeDefined();
    firstRoot.unmount();
    secondRoot.unmount();
  });

  it("supports a state update from passive effect setup", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      useConditionalEffect("effect", () => setCount((value) => value + 1), []);
      return <span>{count}</span>;
    };

    render(<Component />);
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
  });

  it("restores the native dispatcher when installation is disposed", async () => {
    const installation = install({ interceptReactHooks: true });
    installation();

    const Component = (): React.ReactNode => {
      const [count, setCount] = React.useState(0);
      return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
  });
});
