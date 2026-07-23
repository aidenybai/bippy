import { installConditionalHooks, type ConditionalHooksOptions } from "../src/index.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
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
  return {
    promise,
    resolve: resolvePromise,
  };
};

afterEach(() => {
  cleanup();
  for (const installation of installations.splice(0)) installation();
});

describe("conditional hook edge cases", () => {
  it("does not commit an effect from a suspended render", async () => {
    install();
    const deferred = createDeferred<void>();
    const events: string[] = [];
    let didResolve = false;

    const SuspendedComponent = (): React.ReactNode => {
      React.useState(0);
      React.useEffect(() => {
        events.push("mounted");
        return () => events.push("cleaned");
      }, []);
      if (!didResolve) throw deferred.promise;
      return <span>resolved</span>;
    };

    render(
      <React.Suspense fallback={<span>loading</span>}>
        <SuspendedComponent />
      </React.Suspense>,
    );
    expect(screen.getByText("loading")).toBeDefined();
    await Promise.resolve();
    expect(events).toEqual([]);

    await act(async () => {
      didResolve = true;
      deferred.resolve();
      await deferred.promise;
    });

    expect(screen.getByText("resolved")).toBeDefined();
    await waitFor(() => expect(events).toEqual(["mounted"]));
  });

  it("does not commit an effect from a render that throws", async () => {
    install();
    const events: string[] = [];

    const BrokenComponent = (): React.ReactNode => {
      React.useEffect(() => {
        events.push("mounted");
      }, []);
      throw new Error("render aborted");
    };

    expect(() => render(<BrokenComponent />)).toThrowError("render aborted");
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it("cleans up changed effect dependencies before starting the replacement", async () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      const [version, setVersion] = React.useState(0);
      React.useEffect(() => {
        events.push(`start:${version}`);
        return () => events.push(`stop:${version}`);
      }, [version]);
      return <button onClick={() => setVersion((value) => value + 1)}>{version}</button>;
    };

    render(<Component />);
    await waitFor(() => expect(events).toEqual(["start:0"]));
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(events).toEqual(["start:0", "stop:0", "start:1"]));
  });

  it("runs layout effects synchronously and cleans them on unmount", () => {
    install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      React.useLayoutEffect(() => {
        events.push("mounted");
        return () => events.push("cleaned");
      }, []);
      return <span>content</span>;
    };

    const rendered = render(<Component />);
    expect(events).toEqual(["mounted"]);
    rendered.unmount();
    expect(events).toEqual(["mounted", "cleaned"]);
  });

  it("cancels a queued passive effect when the component unmounts first", async () => {
    install();
    const effect = vi.fn();

    const Component = (): React.ReactNode => {
      React.useEffect(effect, []);
      return null;
    };

    const rendered = render(<Component />);
    rendered.unmount();
    await Promise.resolve();
    expect(effect).not.toHaveBeenCalled();
  });

  it("cleans active effects when the conditional hook installation is disposed", async () => {
    const installation = install();
    const events: string[] = [];

    const Component = (): React.ReactNode => {
      React.useEffect(() => {
        events.push("mounted");
        return () => events.push("cleaned");
      }, []);
      return null;
    };

    render(<Component />);
    await waitFor(() => expect(events).toEqual(["mounted"]));
    installation();
    expect(events).toEqual(["mounted", "cleaned"]);
  });

  it("keeps a newer installation active when an older disposer is called twice", () => {
    const firstInstallation = install();
    firstInstallation();
    const secondInstallation = install();
    const supportedRenderers = secondInstallation.supportedRenderers;
    expect(supportedRenderers).toBeGreaterThan(0);
    firstInstallation();
    expect(secondInstallation.supportedRenderers).toBe(supportedRenderers);
  });

  it("gives a remounted Fiber fresh conditional state", async () => {
    install();

    const Counter = (): React.ReactNode => {
      const [count, setCount] = React.useState(0);
      return <button onClick={() => setCount((value) => value + 1)}>count:{count}</button>;
    };

    const Component = (): React.ReactNode => {
      const [generation, setGeneration] = React.useState(0);
      return (
        <div>
          <button onClick={() => setGeneration((value) => value + 1)}>remount</button>
          <Counter key={generation} />
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("count:0"));
    await waitFor(() => expect(screen.getByText("count:1")).toBeDefined());
    fireEvent.click(screen.getByText("remount"));
    expect(screen.getByText("count:0")).toBeDefined();
  });

  it("retains same-callsite loop cells when the loop shrinks and grows", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [itemCount, setItemCount] = React.useState(1);
      const items: React.ReactNode[] = [];
      for (let index = 0; index < itemCount; index++) {
        const [value, setValue] = React.useState(index);
        items.push(
          <button key={index} onClick={() => setValue((currentValue) => currentValue + 10)}>
            {index}:{value}
          </button>,
        );
      }
      return (
        <div>
          <button onClick={() => setItemCount(1)}>shrink</button>
          <button onClick={() => setItemCount(3)}>grow</button>
          {items}
        </div>
      );
    };

    render(<Component />);
    fireEvent.click(screen.getByText("grow"));
    fireEvent.click(screen.getByText("1:1"));
    await waitFor(() => expect(screen.getByText("1:11")).toBeDefined());
    fireEvent.click(screen.getByText("shrink"));
    expect(screen.queryByText("1:11")).toBeNull();
    fireEvent.click(screen.getByText("grow"));
    expect(screen.getByText("1:11")).toBeDefined();
  });

  it("applies multiple functional updates from one event", async () => {
    install();

    const Component = (): React.ReactNode => {
      const [count, setCount] = React.useState(0);
      const incrementTwice = (): void => {
        setCount((value) => value + 1);
        setCount((value) => value + 1);
      };
      return <button onClick={incrementTwice}>{count}</button>;
    };

    render(<Component />);
    fireEvent.click(screen.getByText("0"));
    await waitFor(() => expect(screen.getByText("2")).toBeDefined());
  });

  it("does not rerender for an Object.is-equal state update", async () => {
    install();
    let renderCount = 0;

    const Component = (): React.ReactNode => {
      renderCount++;
      const [count, setCount] = React.useState(0);
      return <button onClick={() => setCount(0)}>{count}</button>;
    };

    render(<Component />);
    expect(renderCount).toBe(1);
    fireEvent.click(screen.getByText("0"));
    await Promise.resolve();
    expect(renderCount).toBe(1);
  });

  it("ignores a captured setter after its Fiber unmounts", () => {
    install();
    let capturedSetter: React.Dispatch<React.SetStateAction<number>> | undefined;

    const Component = (): React.ReactNode => {
      const [count, setCount] = React.useState(0);
      capturedSetter = setCount;
      return <span>{count}</span>;
    };

    const rendered = render(<Component />);
    rendered.unmount();
    expect(capturedSetter).toBeDefined();
    const update = vi.fn((value: number) => value + 1);
    expect(() => capturedSetter?.(update)).not.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
