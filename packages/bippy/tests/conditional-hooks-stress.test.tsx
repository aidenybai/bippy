import { installConditionalHooks, type ConditionalHooksOptions } from "../src/index.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

interface FactorCounterProperties {
  factor: number;
}

interface KeyedCounterProperties {
  name: string;
}

interface VersionedEffectProperties {
  version: number;
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

describe("conditional hook stress cases", () => {
  it("runs a lazy state initializer only once across branch toggles", () => {
    install();
    const initialize = vi.fn(() => 7);

    const Component = (): React.ReactNode => {
      const [isVisible, setIsVisible] = React.useState(true);
      const content = isVisible ? React.useState(initialize)[0] : "hidden";
      return <button onClick={() => setIsVisible((value) => !value)}>{content}</button>;
    };

    render(<Component />);
    expect(screen.getByText("7")).toBeDefined();
    fireEvent.click(screen.getByText("7"));
    fireEvent.click(screen.getByText("hidden"));
    expect(screen.getByText("7")).toBeDefined();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("runs a reducer initializer only once", async () => {
    install();
    const initialize = vi.fn((value: number) => value * 2);

    const Component = (): React.ReactNode => {
      const [renderVersion, setRenderVersion] = React.useState(0);
      const [count] = React.useReducer((state: number) => state, 3, initialize);
      return (
        <button onClick={() => setRenderVersion((value) => value + 1)}>
          {count}:{renderVersion}
        </button>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("6:0"));
    await waitFor(() => expect(screen.getByText("6:1")).toBeDefined());
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("keeps state setter, reducer dispatcher, and ref identities stable", async () => {
    install();
    const stateSetters: Array<React.Dispatch<React.SetStateAction<number>>> = [];
    const reducerDispatchers: Array<(action: number) => void> = [];
    const references: Array<{ current: number }> = [];

    const Component = (): React.ReactNode => {
      const [renderVersion, setRenderVersion] = React.useState(0);
      const [, setCount] = React.useState(0);
      const [, dispatch] = React.useReducer((state: number, amount: number) => state + amount, 0);
      const reference = React.useRef(0);
      stateSetters.push(setCount);
      reducerDispatchers.push(dispatch);
      references.push(reference);
      return (
        <button onClick={() => setRenderVersion((value) => value + 1)}>{renderVersion}</button>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("1")).toBeDefined());
    expect(stateSetters[1]).toBe(stateSetters[0]);
    expect(reducerDispatchers[1]).toBe(reducerDispatchers[0]);
    expect(references[1]).toBe(references[0]);
  });

  it("uses the latest reducer closure", async () => {
    install();

    const FactorCounter = ({ factor }: FactorCounterProperties): React.ReactNode => {
      const [count, dispatch] = React.useReducer(
        (state: number, amount: number) => state + amount * factor,
        0,
      );
      return <button onClick={() => dispatch(1)}>count:{count}</button>;
    };

    const Component = (): React.ReactNode => {
      const [factor, setFactor] = React.useState(1);
      return (
        <div>
          <button onClick={() => setFactor(5)}>factor:{factor}</button>
          <FactorCounter factor={factor} />
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("factor:1"));
    fireEvent.click(screen.getByText("count:0"));
    await waitFor(() => expect(screen.getByText("count:5")).toBeDefined());
  });

  it("renders a queued reducer action even when it returns identical state", async () => {
    install();
    let renderCount = 0;

    const Component = (): React.ReactNode => {
      renderCount++;
      const [value, dispatch] = React.useReducer((state: number) => state, 1);
      return <button onClick={() => dispatch(0)}>{value}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("1"));
    await Promise.resolve();
    expect(renderCount).toBe(2);
  });

  it("ignores a captured reducer dispatcher after unmount", () => {
    install();
    const reduce = vi.fn((state: number, amount: number) => state + amount);
    let capturedDispatch: ((action: number) => void) | undefined;

    const Component = (): React.ReactNode => {
      const [, dispatch] = React.useReducer(reduce, 0);
      capturedDispatch = dispatch;
      return null;
    };

    const rendered = render(<Component />);
    rendered.unmount();
    capturedDispatch?.(1);
    expect(reduce).not.toHaveBeenCalled();
  });

  it("stores a function as state through initializer and updater functions", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [getLabel, setGetLabel] = React.useState(() => () => "first");
      return <button onClick={() => setGetLabel(() => () => "second")}>{getLabel()}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("first"));
    await waitFor(() => expect(screen.getByText("second")).toBeDefined());
  });

  it("uses Object.is semantics for memo dependencies", () => {
    install();
    const createMemo = vi.fn((value: number) => String(value));

    const Component = (): React.ReactNode => {
      const [dependency, setDependency] = React.useState(Number.NaN);
      const memoized = React.useMemo(() => createMemo(dependency), [dependency]);
      return (
        <button
          onClick={() => setDependency((value) => (Number.isNaN(value) ? Number.NaN : value))}
        >
          {memoized}
        </button>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("NaN"));
    expect(createMemo).toHaveBeenCalledTimes(1);
  });

  it("distinguishes positive and negative zero memo dependencies", async () => {
    install();
    const createMemo = vi.fn((value: number) => (Object.is(value, -0) ? "negative" : "positive"));

    const Component = (): React.ReactNode => {
      const [dependency, setDependency] = React.useState(0);
      const memoized = React.useMemo(() => createMemo(dependency), [dependency]);
      return <button onClick={() => setDependency(-0)}>{memoized}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("positive"));
    await waitFor(() => expect(screen.getByText("negative")).toBeDefined());
    expect(createMemo).toHaveBeenCalledTimes(2);
  });

  it("recomputes a memo with omitted dependencies on every render", async () => {
    install();
    const createMemo = vi.fn(() => "memoized");

    const Component = (): React.ReactNode => {
      const [renderVersion, setRenderVersion] = React.useState(0);
      const memoized = React.useMemo(createMemo);
      return (
        <button onClick={() => setRenderVersion((value) => value + 1)}>
          {memoized}:{renderVersion}
        </button>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("memoized:0"));
    await waitFor(() => expect(screen.getByText("memoized:1")).toBeDefined());
    expect(createMemo).toHaveBeenCalledTimes(2);
  });

  it("preserves callbacks until their dependencies change", async () => {
    install();
    const callbacks: Array<() => number> = [];

    const Component = (): React.ReactNode => {
      const [dependency, setDependency] = React.useState(0);
      const [renderVersion, setRenderVersion] = React.useState(0);
      const callback = React.useCallback(() => dependency, [dependency]);
      callbacks.push(callback);
      return (
        <div>
          <button onClick={() => setRenderVersion((value) => value + 1)}>
            render:{renderVersion}
          </button>
          <button onClick={() => setDependency((value) => value + 1)}>
            dependency:{dependency}
          </button>
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("render:0"));
    await waitFor(() => expect(screen.getByText("render:1")).toBeDefined());
    expect(callbacks[1]).toBe(callbacks[0]);
    fireEvent.click(screen.getByText("dependency:0"));
    await waitFor(() => expect(screen.getByText("dependency:1")).toBeDefined());
    expect(callbacks[2]).not.toBe(callbacks[1]);
    expect(callbacks[2]?.()).toBe(1);
  });

  it("restarts an effect with omitted dependencies after every commit", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      const [version, setVersion] = React.useState(0);
      React.useEffect(() => {
        events.push(`start:${version}`);
        return () => events.push(`stop:${version}`);
      });
      return <button onClick={() => setVersion((value) => value + 1)}>{version}</button>;
    };

    render(<Component />);
    await waitFor(() => expect(events).toEqual(["start:0"]));
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(events).toEqual(["start:0", "stop:0", "start:1"]));
  });

  it("restarts an effect when the dependency array length changes", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      const [isExpanded, setIsExpanded] = React.useState(false);
      const dependencies = isExpanded ? [1, 2] : [1];
      React.useEffect(() => {
        events.push(`start:${dependencies.length}`);
        return () => events.push(`stop:${dependencies.length}`);
      }, dependencies);
      return <button onClick={() => setIsExpanded(true)}>{dependencies.length}</button>;
    };

    render(<Component />);
    await waitFor(() => expect(events).toEqual(["start:1"]));
    fireEvent.click(screen.getByText("1"));
    await waitFor(() => expect(events).toEqual(["start:1", "stop:1", "start:2"]));
  });

  it("cancels a queued effect when its branch disappears", async () => {
    install();
    const effect = vi.fn();

    const Component = (): React.ReactNode => {
      const [isVisible, setIsVisible] = React.useState(true);
      if (isVisible) React.useEffect(effect, []);
      return <button onClick={() => setIsVisible(false)}>hide</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("hide"));
    await Promise.resolve();
    expect(effect).not.toHaveBeenCalled();
  });

  it("starts only the latest queued effect after a rapid dependency change", async () => {
    install();
    const events: string[] = [];

    const VersionedEffect = ({ version }: VersionedEffectProperties): React.ReactNode => {
      React.useEffect(() => {
        events.push(`start:${version}`);
      }, [version]);
      return <span>{version}</span>;
    };

    const rendered = render(<VersionedEffect version={0} />);
    rendered.rerender(<VersionedEffect version={1} />);
    await waitFor(() => expect(events).toEqual(["start:1"]));
  });

  it("ignores state updates triggered by cleanup during unmount", async () => {
    install();
    const update = vi.fn((value: number) => value + 1);

    const Component = (): React.ReactNode => {
      const [, setCount] = React.useState(0);
      React.useEffect(() => () => setCount(update), []);
      return null;
    };

    const rendered = render(<Component />);
    await Promise.resolve();
    rendered.unmount();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps adjacent automatic hook callsites distinct", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [numericValue, setNumericValue] = React.useState(0);
      const [stringValue, setStringValue] = React.useState(10);
      const [symbolValue, setSymbolValue] = React.useState(100);
      const incrementAll = (): void => {
        setNumericValue((value) => value + 1);
        setStringValue((value) => value + 1);
        setSymbolValue((value) => value + 1);
      };
      return (
        <button onClick={incrementAll}>
          {numericValue}:{stringValue}:{symbolValue}
        </button>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("0:10:100"));
    await waitFor(() => expect(screen.getByText("1:11:101")).toBeDefined());
  });

  it("keeps state attached to keyed Fibers when siblings reorder", async () => {
    install();

    const KeyedCounter = ({ name }: KeyedCounterProperties): React.ReactNode => {
      const [count, setCount] = React.useState(0);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          {name}:{count}
        </button>
      );
    };

    const Component = (): React.ReactNode => {
      const [names, setNames] = React.useState(["first", "second", "third"]);
      return (
        <div>
          <button onClick={() => setNames((values) => [...values].reverse())}>reverse</button>
          {names.map((name) => (
            <KeyedCounter key={name} name={name} />
          ))}
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("second:0"));
    await waitFor(() => expect(screen.getByText("second:1")).toBeDefined());
    fireEvent.click(screen.getByText("reverse"));
    expect(screen.getByText("second:1")).toBeDefined();
    expect(screen.getByText("first:0")).toBeDefined();
    expect(screen.getByText("third:0")).toBeDefined();
  });

  it("separates repeated automatic keys by occurrence", async () => {
    install({ getHookKey: () => "shared-callsite" });

    const Component = (): React.ReactNode => {
      const [first, setFirst] = React.useState(0);
      const [second, setSecond] = React.useState(10);
      return (
        <div>
          <button onClick={() => setFirst((value) => value + 1)}>first:{first}</button>
          <button onClick={() => setSecond((value) => value + 1)}>second:{second}</button>
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("first:0"));
    fireEvent.click(screen.getByText("second:10"));
    await waitFor(() => {
      expect(screen.getByText("first:1")).toBeDefined();
      expect(screen.getByText("second:11")).toBeDefined();
    });
  });

  it("propagates errors from a custom automatic key resolver", () => {
    install({
      getHookKey: () => {
        throw new Error("resolver failed");
      },
    });

    const BrokenComponent = (): React.ReactNode => {
      React.useState(0);
      return null;
    };

    expect(() => render(<BrokenComponent />)).toThrowError("resolver failed");
  });

  it("forwards conditional useContext reads through the native dispatcher", () => {
    install();
    const LabelContext = React.createContext("default");

    const Component = (): React.ReactNode => {
      const [isVisible, setIsVisible] = React.useState(false);
      const label = isVisible ? React.useContext(LabelContext) : "hidden";
      return <button onClick={() => setIsVisible((value) => !value)}>{label}</button>;
    };

    render(
      <LabelContext.Provider value="provided">
        <Component />
      </LabelContext.Provider>,
    );
    fireEvent.click(screen.getByText("hidden"));
    expect(screen.getByText("provided")).toBeDefined();
    fireEvent.click(screen.getByText("provided"));
    expect(screen.getByText("hidden")).toBeDefined();
  });

  it("coexists with a native useId hook", async () => {
    install();
    const identifiers: string[] = [];

    const Component = (): React.ReactNode => {
      const identifier = React.useId();
      const [count, setCount] = React.useState(0);
      identifiers.push(identifier);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          {identifier}:{count}
        </button>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain(":1"));
    expect(identifiers[1]).toBe(identifiers[0]);
  });

  it("keeps the committed effect active while an update is suspended", async () => {
    install();
    const deferred = createDeferred<void>();
    const events: string[] = [];
    let setVersion: React.Dispatch<React.SetStateAction<number>> | undefined;
    let didResolve = false;

    const Component = (): React.ReactNode => {
      const [version, updateVersion] = React.useState(0);
      setVersion = updateVersion;
      React.useEffect(() => {
        events.push(`start:${version}`);
        return () => events.push(`stop:${version}`);
      }, [version]);
      if (version === 1 && !didResolve) throw deferred.promise;
      return <span>version:{version}</span>;
    };

    render(
      <React.Suspense fallback={<span>loading</span>}>
        <Component />
      </React.Suspense>,
    );
    await waitFor(() => expect(events).toEqual(["start:0"]));

    act(() => setVersion?.(1));
    expect(events).toEqual(["start:0"]);

    await act(async () => {
      didResolve = true;
      deferred.resolve();
      await deferred.promise;
    });

    expect(screen.getByText("version:1")).toBeDefined();
    await waitFor(() => expect(events).toEqual(["start:0", "stop:0", "start:1"]));
  });
});
