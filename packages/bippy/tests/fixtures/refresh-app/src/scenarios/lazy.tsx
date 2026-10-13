// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type * as React from "react";

import type { HarnessTools, Scenario } from "../harness";

interface LazyResolver {
  (): void;
}

interface WrapHello {
  (tools: HarnessTools, renderHello: () => React.ReactElement): React.ComponentType<object>;
}

const defineColoredHello = (tools: HarnessTools, color: string) => {
  const { React: ReactModule } = tools;
  return () => {
    const [value, setValue] = ReactModule.useState(0);
    return (
      <p style={{ color }} onClick={() => setValue(value + 1)}>
        {value}
      </p>
    );
  };
};

// Shared skeleton for the four "can patch lazy(...) before resolution"
// tests, which differ only in the wrapper around the lazy payload.
const runPatchLazyBeforeResolution = async (
  tools: HarnessTools,
  wrapHello: WrapHello,
): Promise<void> => {
  const {
    React: ReactModule,
    render,
    patch,
    act,
    expect,
    firstElement,
    clickElement,
    container,
  } = tools;

  let resolveLazy: LazyResolver = () => {};

  const defineHelloVersion = (color: string): void => {
    const renderHello = defineColoredHello(tools, color);
    const Hello = wrapHello(tools, renderHello);
    tools.register(Hello, "Hello");
  };

  await render(() => {
    const renderHello = defineColoredHello(tools, "blue");
    const Hello = wrapHello(tools, renderHello);
    tools.register(Hello, "Hello");

    const Outer = ReactModule.lazy(
      () =>
        new Promise<{ default: React.ComponentType<object> }>((innerResolve) => {
          resolveLazy = () => innerResolve({ default: Hello });
        }),
    );
    tools.register(Outer, "Outer");

    const App = () => (
      <ReactModule.Suspense fallback={<p>Loading</p>}>
        <Outer />
      </ReactModule.Suspense>
    );
    return App;
  });

  expect(container.textContent).toBe("Loading");

  // Hot update while still suspended.
  await patch(() => defineHelloVersion("red"));

  await act(() => {
    resolveLazy();
  });

  // The patched version must be the one that mounts.
  const element = firstElement();
  expect(element.textContent).toBe("0");
  expect(element.style.color).toBe("red");

  await clickElement(element);
  expect(container.firstChild).toBe(element);
  expect(element.textContent).toBe("1");
  expect(element.style.color).toBe("red");

  // Another reload after resolution keeps state.
  await patch(() => defineHelloVersion("orange"));
  expect(container.firstChild).toBe(element);
  expect(element.textContent).toBe("1");
  expect(element.style.color).toBe("orange");
};

export const lazyScenarios: Record<string, Scenario> = {
  "preserves state for lazy after resolution": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      act,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    let resolveLazy: LazyResolver = () => {};

    const defineApp = (color: string) => {
      const Hello = defineColoredHello(tools, color);
      tools.register(Hello, "Hello");

      const Outer = ReactModule.lazy(
        () =>
          new Promise<{ default: React.ComponentType<object> }>((innerResolve) => {
            resolveLazy = () => innerResolve({ default: Hello });
          }),
      );
      tools.register(Outer, "Outer");

      const App = () => (
        <ReactModule.Suspense fallback={<p>Loading</p>}>
          <Outer />
        </ReactModule.Suspense>
      );
      tools.register(App, "App");
      return App;
    };

    const AppV1 = await render(() => defineApp("blue"));

    expect(container.textContent).toBe("Loading");
    await act(() => {
      resolveLazy();
    });
    expect(container.textContent).toBe("0");

    const element = firstElement();
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    const AppV2 = await patch(() => defineApp("red"));

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");

    await clickElement(element);
    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("2");
    expect(element.style.color).toBe("red");

    await render(() => AppV1);
    await render(() => AppV2);
    await render(() => AppV1);
    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("2");
    expect(element.style.color).toBe("red");

    // Rendering without the lazy wrapper is an incompatible type.
    await render(() => {
      const Hello = defineColoredHello(tools, "blue");
      tools.register(Hello, "Hello");
      const App = () => (
        <ReactModule.Suspense fallback={<p>Loading</p>}>
          <Hello />
        </ReactModule.Suspense>
      );
      tools.register(App, "App");
      return App;
    });

    expect(container.firstChild).not.toBe(element);
    const remountedElement = firstElement();
    expect(remountedElement.textContent).toBe("0");
    expect(remountedElement.style.color).toBe("blue");
  },

  "patches lazy before resolution": async (tools) => {
    await runPatchLazyBeforeResolution(tools, (_innerTools, renderHello) => renderHello);
  },

  "patches lazy(forwardRef) before resolution": async (tools) => {
    await runPatchLazyBeforeResolution(tools, ({ React: ReactModule }, renderHello) =>
      ReactModule.forwardRef(renderHello),
    );
  },

  "patches lazy(memo) before resolution": async (tools) => {
    await runPatchLazyBeforeResolution(tools, ({ React: ReactModule }, renderHello) =>
      ReactModule.memo(renderHello),
    );
  },

  "patches lazy(memo(forwardRef)) before resolution": async (tools) => {
    await runPatchLazyBeforeResolution(tools, ({ React: ReactModule }, renderHello) =>
      ReactModule.memo(ReactModule.forwardRef(renderHello)),
    );
  },

  "remounts lazy(memo()) when adding a comparison function": async (tools) => {
    const { React: ReactModule, render, patch, act, expect, firstElement, container } = tools;

    let resolveLazy: LazyResolver = () => {};

    const defineApp = (text: string, compare?: () => boolean) => {
      const Hello = () => <p>{text}</p>;
      const Inner = compare ? ReactModule.memo(Hello, compare) : ReactModule.memo(Hello);
      tools.register(Hello, "Hello");
      tools.register(Inner, "Inner");

      const Outer = ReactModule.lazy(
        () =>
          new Promise<{ default: React.ComponentType<object> }>((innerResolve) => {
            resolveLazy = () => innerResolve({ default: Inner });
          }),
      );
      tools.register(Outer, "Outer");

      const App = () => (
        <ReactModule.Suspense fallback={<p>Loading</p>}>
          <Outer />
        </ReactModule.Suspense>
      );
      tools.register(App, "App");
      return App;
    };

    await render(() => defineApp("hi memo"));

    expect(container.textContent).toBe("Loading");
    await act(() => {
      resolveLazy();
    });
    expect(container.textContent).toBe("hi memo");
    const element = firstElement();

    // The module creating the lazy also re-runs, like when an edit
    // propagates upwards. The shape change forces a remount through the
    // new lazy type, which suspends until it resolves again.
    await patch(() => defineApp("hi memo with compare", () => false));

    expect(container.textContent).toBe("hi memoLoading");
    await act(() => {
      resolveLazy();
    });
    expect(container.textContent).toBe("hi memo with compare");
    expect(container.firstChild).not.toBe(element);
  },

  "remounts lazy(memo()) when adding a comparison without re-creating the lazy": async (tools) => {
    const { React: ReactModule, render, patch, act, expect, firstElement, container } = tools;

    let resolveLazy: LazyResolver = () => {};

    await render(() => {
      const Hello = () => <p>hi memo</p>;
      const Inner = ReactModule.memo(Hello);
      tools.register(Hello, "Hello");
      tools.register(Inner, "Inner");

      const Outer = ReactModule.lazy(
        () =>
          new Promise<{ default: React.ComponentType<object> }>((innerResolve) => {
            resolveLazy = () => innerResolve({ default: Inner });
          }),
      );
      tools.register(Outer, "Outer");

      const App = () => (
        <ReactModule.Suspense fallback={<p>Loading</p>}>
          <Outer />
        </ReactModule.Suspense>
      );
      tools.register(App, "App");
      return App;
    });

    expect(container.textContent).toBe("Loading");
    await act(() => {
      resolveLazy();
    });
    expect(container.textContent).toBe("hi memo");
    const element = firstElement();

    // Only the lazily loaded module re-runs, so the remount goes through
    // the old lazy whose payload is already resolved (no suspension).
    await patch(() => {
      const Hello = () => <p>hi memo with compare</p>;
      const Inner = ReactModule.memo(Hello, () => false);
      tools.register(Hello, "Hello");
      tools.register(Inner, "Inner");
      return Inner;
    });

    expect(container.textContent).toBe("hi memo with compare");
    expect(container.firstChild).not.toBe(element);
  },
};
