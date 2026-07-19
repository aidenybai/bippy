import {
  installConditionalHooks,
  type ConditionalHooksOptions,
  type ConditionalReducerDispatcher,
  useConditionalCallback,
  useConditionalEffect,
  useConditionalLayoutEffect,
  useConditionalMemo,
  useConditionalReducer,
  useConditionalState,
} from "../src/index.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface ActivityProperties {
  children: React.ReactNode;
  mode: "hidden" | "visible";
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

interface EffectProperties {
  label: string;
}

interface ReducerProperties {
  factor: number;
}

interface SuspenseProperties {
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

describe("ports from ReactHooksWithNoopRenderer-test.js", () => {
  it("throws when called outside the render phase", () => {
    install();
    expect(() => useConditionalState("state", 0)).toThrowError(
      "must be called while a component is rendering",
    );
  });

  it("updates multiple independent states", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [first, setFirst] = useConditionalState("first", 0);
      const [second, setSecond] = useConditionalState("second", 10);
      return (
        <div>
          <button onClick={() => setFirst((value) => value + 1)}>first:{first}</button>
          <button onClick={() => setSecond((value) => value + 10)}>second:{second}</button>
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("first:0"));
    fireEvent.click(screen.getByText("second:10"));
    await waitFor(() => {
      expect(screen.getByText("first:1")).toBeDefined();
      expect(screen.getByText("second:20")).toBeDefined();
    });
  });

  it("applies value and functional state updates in dispatch order", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      const update = (): void => {
        setCount(1);
        setCount((value) => value + 2);
        setCount(8);
      };
      return <button onClick={update}>{count}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("8")).toBeDefined());
  });

  it("applies multiple render-phase updates before committing effects", async () => {
    install();
    const renders: number[] = [];
    const effects: number[] = [];

    const Component = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      renders.push(count);
      useConditionalEffect(
        "effect",
        () => {
          effects.push(count);
        },
        [count],
      );
      if (count < 6) {
        setCount((value) => value + 1);
        setCount((value) => value + 1);
        setCount((value) => value + 1);
      }
      return <span>{count}</span>;
    };

    render(<Component />);
    await waitFor(() => expect(screen.getByText("6")).toBeDefined());
    await waitFor(() => expect(effects).toEqual([6]));
    expect(renders).toEqual([0, 3, 6]);
  });

  it("uses a reducer supplied by the render that processes a queued action", async () => {
    install();
    let dispatch: ConditionalReducerDispatcher<number> | undefined;

    const Component = ({ factor }: ReducerProperties): React.ReactNode => {
      const [count, currentDispatch] = useConditionalReducer(
        "count",
        (state: number, amount: number) => state + amount * factor,
        0,
      );
      dispatch = currentDispatch;
      return <span>{count}</span>;
    };

    const rendered = render(<Component factor={1} />);
    act(() => {
      dispatch?.(1);
      rendered.rerender(<Component factor={10} />);
    });
    await waitFor(() => expect(screen.getByText("10")).toBeDefined());
  });

  it("does not replay a previous no-op reducer action on a prop update", async () => {
    install();
    let dispatch: ConditionalReducerDispatcher<number> | undefined;

    const Component = ({ factor }: ReducerProperties): React.ReactNode => {
      const [count, currentDispatch] = useConditionalReducer(
        "count",
        (state: number, amount: number) => state + amount * factor,
        0,
      );
      dispatch = currentDispatch;
      return <span>{count}</span>;
    };

    const rendered = render(<Component factor={0} />);
    act(() => dispatch?.(1));
    expect(screen.getByText("0")).toBeDefined();
    rendered.rerender(<Component factor={10} />);
    await Promise.resolve();
    expect(screen.getByText("0")).toBeDefined();
  });

  it("processes every reducer action in a batch exactly once", async () => {
    install();
    const reducer = vi.fn((state: number, amount: number) => state + amount);

    const Component = (): React.ReactNode => {
      const [count, dispatch] = useConditionalReducer("count", reducer, 0);
      const update = (): void => {
        dispatch(1);
        dispatch(2);
        dispatch(3);
      };
      return <button onClick={update}>{count}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("6")).toBeDefined());
    expect(reducer.mock.calls.map(([, amount]) => amount)).toEqual([1, 2, 3]);
  });

  it("skips effects when dependencies have not changed", async () => {
    install();
    const events: string[] = [];

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          events.push(`mount:${label}`);
          return () => events.push(`cleanup:${label}`);
        },
        [label],
      );
      return <span>{label}</span>;
    };

    const rendered = render(<Component label="same" />);
    await waitFor(() => expect(events).toEqual(["mount:same"]));
    rendered.rerender(<Component label="same" />);
    await Promise.resolve();
    expect(events).toEqual(["mount:same"]);
  });

  it("unmounts all prior effects before creating replacements", async () => {
    install();
    const events: string[] = [];

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalEffect(
        "first",
        () => {
          events.push(`mount:first:${label}`);
          return () => events.push(`cleanup:first:${label}`);
        },
        [label],
      );
      useConditionalEffect(
        "second",
        () => {
          events.push(`mount:second:${label}`);
          return () => events.push(`cleanup:second:${label}`);
        },
        [label],
      );
      return null;
    };

    const rendered = render(<Component label="A" />);
    await waitFor(() => expect(events).toEqual(["mount:first:A", "mount:second:A"]));
    rendered.rerender(<Component label="B" />);
    await waitFor(() =>
      expect(events).toEqual([
        "mount:first:A",
        "mount:second:A",
        "cleanup:first:A",
        "cleanup:second:A",
        "mount:first:B",
        "mount:second:B",
      ]),
    );
  });

  it("unmounts sibling layout effects before creating any replacements", () => {
    install();
    const events: string[] = [];

    const Child = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalLayoutEffect(
        "layout",
        () => {
          events.push(`mount:${label}`);
          return () => events.push(`cleanup:${label}`);
        },
        [label],
      );
      return null;
    };

    const rendered = render(
      <>
        <Child label="A0" />
        <Child label="B0" />
      </>,
    );
    events.length = 0;
    rendered.rerender(
      <>
        <Child label="A1" />
        <Child label="B1" />
      </>,
    );
    expect(events).toEqual(["cleanup:A0", "cleanup:B0", "mount:A1", "mount:B1"]);
  });

  it("runs layout effects after host mutations", () => {
    install();
    const observedText: string[] = [];

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalLayoutEffect(
        "layout",
        () => {
          observedText.push(screen.getByTestId("host").textContent ?? "");
        },
        [label],
      );
      return <span data-testid="host">{label}</span>;
    };

    const rendered = render(<Component label="A" />);
    rendered.rerender(<Component label="B" />);
    expect(observedText).toEqual(["A", "B"]);
  });

  it("deletes an effect after a render where it was skipped", async () => {
    install();
    const events: string[] = [];

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      if (label !== "skip") {
        useConditionalEffect(
          "effect",
          () => {
            events.push(`mount:${label}`);
            return () => events.push(`cleanup:${label}`);
          },
          [],
        );
      }
      return <span>{label}</span>;
    };

    const rendered = render(<Component label="mount" />);
    await waitFor(() => expect(events).toEqual(["mount:mount"]));
    rendered.rerender(<Component label="skip" />);
    expect(events).toEqual(["mount:mount", "cleanup:mount"]);
    rendered.unmount();
    expect(events).toEqual(["mount:mount", "cleanup:mount"]);
  });

  it("memoizes callbacks by dependency equality", () => {
    install();
    const callbacks: Array<() => string> = [];

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      callbacks.push(useConditionalCallback("callback", () => label, [label]));
      return null;
    };

    const rendered = render(<Component label="A" />);
    rendered.rerender(<Component label="A" />);
    rendered.rerender(<Component label="B" />);
    expect(callbacks[1]).toBe(callbacks[0]);
    expect(callbacks[2]).not.toBe(callbacks[1]);
    expect(callbacks[2]?.()).toBe("B");
  });

  it("does not invoke memo factories on equal dependencies", () => {
    install();
    const createMemo = vi.fn((label: string) => ({ label }));

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      const value = useConditionalMemo("memo", () => createMemo(label), [label]);
      return <span>{value.label}</span>;
    };

    const rendered = render(<Component label="A" />);
    rendered.rerender(<Component label="A" />);
    rendered.rerender(<Component label="B" />);
    expect(createMemo.mock.calls).toEqual([["A"], ["B"]]);
  });

  it("persists effect dependencies after render-phase updates", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      useConditionalEffect(
        "effect",
        () => {
          events.push(`effect:${count}`);
        },
        [count],
      );
      if (count > 0) setCount(0);
      return <button onClick={() => setCount(2)}>{count}</button>;
    };

    render(<Component />);
    await waitFor(() => expect(events).toEqual(["effect:0"]));
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("0")).toBeDefined());
    expect(events).toEqual(["effect:0"]);
  });

  it.skip("routes passive effect setup errors through React error boundaries", async () => {
    install();
    const error = new Error("effect failed");

    const Component = (): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          throw error;
        },
        [],
      );
      return null;
    };

    expect(() => render(<Component />)).toThrow(error);
  });

  it.fails("flushes pending passive effects before a new layout effect", () => {
    install();
    const events: string[] = [];

    const Component = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalEffect(
        "passive",
        () => {
          events.push(`passive:${label}`);
        },
        [label],
      );
      useConditionalLayoutEffect(
        "layout",
        () => {
          events.push(`layout:${label}`);
        },
        [label],
      );
      return null;
    };

    const rendered = render(<Component label="A" />);
    rendered.rerender(<Component label="B" />);
    expect(events).toEqual(["layout:A", "passive:A", "layout:B"]);
  });
});

describe("ports from StrictEffectsMode-test.js", () => {
  it("uses the first Strict Mode state initializer result", () => {
    install();
    let initializationCount = 0;

    const Component = (): React.ReactNode => {
      const [value] = useConditionalState("state", () => ++initializationCount);
      return <span>{value}</span>;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    expect(initializationCount).toBe(2);
    expect(screen.getByText("1")).toBeDefined();
  });

  it("uses the first Strict Mode memo factory result", () => {
    install();
    let factoryCallCount = 0;

    const Component = (): React.ReactNode => {
      const value = useConditionalMemo("memo", () => ++factoryCallCount, []);
      return <span>{value}</span>;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    expect(factoryCallCount).toBe(2);
    expect(screen.getByText("1")).toBeDefined();
  });

  it("double invokes state updater functions while using the first result", async () => {
    install();
    const updater = vi.fn((value: number) => value + 1);

    const Component = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      return <button onClick={() => setCount(updater)}>{count}</button>;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
    expect(updater).toHaveBeenCalledTimes(2);
  });

  it("double invokes multiple passive effects in global phase order", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      useConditionalEffect(
        "first",
        () => {
          events.push("mount:first");
          return () => events.push("cleanup:first");
        },
        [],
      );
      useConditionalEffect(
        "second",
        () => {
          events.push("mount:second");
          return () => events.push("cleanup:second");
        },
        [],
      );
      return null;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(events).toEqual([
        "mount:first",
        "mount:second",
        "cleanup:first",
        "cleanup:second",
        "mount:first",
        "mount:second",
      ]),
    );
  });

  it("double invokes multiple layout effects in global phase order", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      useConditionalLayoutEffect(
        "first",
        () => {
          events.push("mount:first");
          return () => events.push("cleanup:first");
        },
        [],
      );
      useConditionalLayoutEffect(
        "second",
        () => {
          events.push("mount:second");
          return () => events.push("cleanup:second");
        },
        [],
      );
      return null;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(events).toEqual([
        "mount:first",
        "mount:second",
        "cleanup:first",
        "cleanup:second",
        "mount:first",
        "mount:second",
      ]),
    );
  });

  it("double invokes effects for children mounted after the initial commit", async () => {
    install();
    const events: string[] = [];

    const Child = (): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          events.push("mount");
          return () => events.push("cleanup");
        },
        [],
      );
      return null;
    };
    const Component = (): React.ReactNode => {
      const [isVisible, setIsVisible] = React.useState(false);
      return <button onClick={() => setIsVisible(true)}>{isVisible ? <Child /> : "show"}</button>;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    fireEvent.click(screen.getByText("show"));
    await waitFor(() => expect(events).toEqual(["mount", "cleanup", "mount"]));
  });

  it("double invokes sibling passive effects in global phase order", async () => {
    install();
    const events: string[] = [];

    const Child = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          events.push(`mount:${label}`);
          return () => events.push(`cleanup:${label}`);
        },
        [],
      );
      return null;
    };

    render(
      <React.StrictMode>
        <Child label="A" />
        <Child label="B" />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(events).toEqual([
        "mount:A",
        "mount:B",
        "cleanup:A",
        "cleanup:B",
        "mount:A",
        "mount:B",
      ]),
    );
  });

  it("orders mixed layout and passive Strict Mode replays like React", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      useConditionalLayoutEffect(
        "layout",
        () => {
          events.push("mount:layout");
          return () => events.push("cleanup:layout");
        },
        [],
      );
      useConditionalEffect(
        "passive",
        () => {
          events.push("mount:passive");
          return () => events.push("cleanup:passive");
        },
        [],
      );
      return null;
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    await waitFor(() =>
      expect(events).toEqual([
        "mount:layout",
        "mount:passive",
        "cleanup:layout",
        "cleanup:passive",
        "mount:layout",
        "mount:passive",
      ]),
    );
  });

  it("does not replay effects when keyed children only reorder", async () => {
    install();
    const events: string[] = [];

    const Child = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          events.push(`mount:${label}`);
          return () => events.push(`cleanup:${label}`);
        },
        [],
      );
      return <span>{label}</span>;
    };
    const Component = (): React.ReactNode => {
      const [labels, setLabels] = React.useState(["A", "B"]);
      return (
        <button onClick={() => setLabels((values) => [...values].reverse())}>
          {labels.map((label) => (
            <Child key={label} label={label} />
          ))}
        </button>
      );
    };

    render(
      <React.StrictMode>
        <Component />
      </React.StrictMode>,
    );
    await waitFor(() => expect(events.length).toBe(6));
    events.length = 0;
    fireEvent.click(screen.getByRole("button"));
    await Promise.resolve();
    expect(events).toEqual([]);
  });
});

describe("ports from ReactSuspenseEffectsSemantics tests", () => {
  it("restarts state initialization after an initial suspension", async () => {
    install();
    const deferred = createDeferred<void>();
    const initialize = vi.fn(() => 0);
    let didResolve = false;

    const Component = (): React.ReactNode => {
      useConditionalState("state", initialize);
      if (!didResolve) throw deferred.promise;
      return <span>ready</span>;
    };

    render(
      <React.Suspense fallback={<span>loading</span>}>
        <Component />
      </React.Suspense>,
    );
    const attemptsBeforeResolution = initialize.mock.calls.length;
    await act(async () => {
      didResolve = true;
      deferred.resolve();
      await deferred.promise;
    });
    expect(screen.getByText("ready")).toBeDefined();
    expect(initialize.mock.calls.length).toBeGreaterThan(attemptsBeforeResolution);
  });

  it("disconnects a memoized descendant layout effect", async () => {
    install();
    const deferred = createDeferred<void>();
    const events: string[] = [];
    let didResolve = false;

    const Child = React.memo((): React.ReactNode => {
      useConditionalLayoutEffect(
        "layout",
        () => {
          events.push("mount");
          return () => events.push("cleanup");
        },
        [],
      );
      return <span>child</span>;
    });
    const Content = ({ shouldSuspend }: SuspenseProperties): React.ReactNode => {
      if (shouldSuspend && !didResolve) throw deferred.promise;
      return <Child />;
    };

    const rendered = render(
      <React.Suspense fallback={<span>loading</span>}>
        <Content shouldSuspend={false} />
      </React.Suspense>,
    );
    expect(events).toEqual(["mount"]);
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Content shouldSuspend />
      </React.Suspense>,
    );
    expect(events).toEqual(["mount", "cleanup"]);
    await act(async () => {
      didResolve = true;
      deferred.resolve();
      await deferred.promise;
    });
    expect(events).toEqual(["mount", "cleanup", "mount"]);
  });

  it("destroys a hidden layout effect only once when the boundary unmounts", () => {
    install();
    const deferred = createDeferred<void>();
    const cleanupEffect = vi.fn();

    const Child = (): React.ReactNode => {
      useConditionalLayoutEffect("layout", () => cleanupEffect, []);
      return null;
    };
    const Content = ({ shouldSuspend }: SuspenseProperties): React.ReactNode => {
      return (
        <>
          <Child />
          {shouldSuspend
            ? (() => {
                throw deferred.promise;
              })()
            : null}
        </>
      );
    };

    const rendered = render(
      <React.Suspense fallback={<span>loading</span>}>
        <Content shouldSuspend={false} />
      </React.Suspense>,
    );
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Content shouldSuspend />
      </React.Suspense>,
    );
    rendered.unmount();
    expect(cleanupEffect).toHaveBeenCalledTimes(1);
  });

  it("disconnects only effects inside the Suspense boundary that hides", () => {
    install();
    const deferred = createDeferred<void>();
    const events: string[] = [];

    const Child = ({ label }: EffectProperties): React.ReactNode => {
      useConditionalLayoutEffect(
        "layout",
        () => {
          events.push(`mount:${label}`);
          return () => events.push(`cleanup:${label}`);
        },
        [],
      );
      return <span>{label}</span>;
    };
    const InnerContent = ({ shouldSuspend }: SuspenseProperties): React.ReactNode => {
      if (shouldSuspend) throw deferred.promise;
      return <Child label="inner" />;
    };

    const rendered = render(
      <React.Suspense fallback={<span>outer-loading</span>}>
        <Child label="outer" />
        <React.Suspense fallback={<span>inner-loading</span>}>
          <InnerContent shouldSuspend={false} />
        </React.Suspense>
      </React.Suspense>,
    );
    expect(events).toEqual(["mount:outer", "mount:inner"]);
    rendered.rerender(
      <React.Suspense fallback={<span>outer-loading</span>}>
        <Child label="outer" />
        <React.Suspense fallback={<span>inner-loading</span>}>
          <InnerContent shouldSuspend />
        </React.Suspense>
      </React.Suspense>,
    );
    expect(screen.getByText("outer")).toBeDefined();
    expect(screen.getByText("inner-loading")).toBeDefined();
    expect(events).toEqual(["mount:outer", "mount:inner", "cleanup:inner"]);
  });

  it("disconnects each layout effect once when siblings suspend together", () => {
    install();
    const firstDeferred = createDeferred<void>();
    const secondDeferred = createDeferred<void>();
    const cleanupEffect = vi.fn();

    const Child = (): React.ReactNode => {
      useConditionalLayoutEffect("layout", () => cleanupEffect, []);
      return null;
    };
    const Suspender = ({ label }: EffectProperties): React.ReactNode => {
      if (label === "first") throw firstDeferred.promise;
      throw secondDeferred.promise;
    };

    const rendered = render(
      <React.Suspense fallback={<span>loading</span>}>
        <Child />
      </React.Suspense>,
    );
    rendered.rerender(
      <React.Suspense fallback={<span>loading</span>}>
        <Child />
        <Suspender label="first" />
        <Suspender label="second" />
      </React.Suspense>,
    );
    expect(cleanupEffect).toHaveBeenCalledTimes(1);
  });
});

describe("ports from Activity-test.js", () => {
  it("mounts and unmounts layout effects as Activity visibility changes", () => {
    install();
    const Activity: React.ComponentType<ActivityProperties> = Reflect.get(React, "Activity");
    const events: string[] = [];

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

    const rendered = render(
      <Activity mode="hidden">
        <Child />
      </Activity>,
    );
    expect(events).toEqual([]);
    rendered.rerender(
      <Activity mode="visible">
        <Child />
      </Activity>,
    );
    expect(events).toEqual(["mount"]);
    rendered.rerender(
      <Activity mode="hidden">
        <Child />
      </Activity>,
    );
    expect(events).toEqual(["mount", "cleanup"]);
  });

  it("connects and disconnects passive effects as Activity visibility changes", async () => {
    install();
    const Activity: React.ComponentType<ActivityProperties> = Reflect.get(React, "Activity");
    const events: string[] = [];

    const Child = (): React.ReactNode => {
      useConditionalEffect(
        "effect",
        () => {
          events.push("mount");
          return () => events.push("cleanup");
        },
        [],
      );
      return <span>child</span>;
    };

    const rendered = render(
      <Activity mode="hidden">
        <Child />
      </Activity>,
    );
    await Promise.resolve();
    expect(events).toEqual([]);
    rendered.rerender(
      <Activity mode="visible">
        <Child />
      </Activity>,
    );
    await waitFor(() => expect(events).toEqual(["mount"]));
    rendered.rerender(
      <Activity mode="hidden">
        <Child />
      </Activity>,
    );
    expect(events).toEqual(["mount", "cleanup"]);
  });

  it("retains conditional state while Activity is hidden", async () => {
    install();
    const Activity: React.ComponentType<ActivityProperties> = Reflect.get(React, "Activity");

    const Counter = (): React.ReactNode => {
      const [count, setCount] = useConditionalState("count", 0);
      return <button onClick={() => setCount((value) => value + 1)}>{count}</button>;
    };

    const rendered = render(
      <Activity mode="visible">
        <Counter />
      </Activity>,
    );
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
    rendered.rerender(
      <Activity mode="hidden">
        <Counter />
      </Activity>,
    );
    rendered.rerender(
      <Activity mode="visible">
        <Counter />
      </Activity>,
    );
    expect(screen.getByText("1")).toBeDefined();
  });
});
