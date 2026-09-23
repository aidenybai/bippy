import { resolve } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { TimerQueue } from "../src/evaluate/timers.js";
import { primitiveValue } from "../src/evaluate/values.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import * as commitRecorderModule from "../src/harness/commit-recorder.js";
import { mountNode } from "../src/materialize/mount.js";
import { loadReactRuntime, type ReactRuntime } from "../src/materialize/react-runtime.js";
import { isRecord } from "../src/observations.js";
import { createDomHost } from "../src/render/dom-host.js";

interface FailureCase {
  name: string;
  hasRenderError: boolean;
  renderError?: unknown;
}

const getRuntime = (): Promise<ReactRuntime> => {
  const rootDirectory = resolve(import.meta.dirname, "..");
  return loadReactRuntime({ rootDirectory, resolver: new ModuleResolver({ rootDirectory }) });
};

const CASES: FailureCase[] = [
  { name: "cleanup alone", hasRenderError: false },
  { name: "a render error", hasRenderError: true, renderError: new Error("render failure") },
  { name: "thrown undefined", hasRenderError: true, renderError: undefined },
  { name: "thrown null", hasRenderError: true, renderError: null },
  {
    name: "an unprintable value",
    hasRenderError: true,
    renderError: {
      toString: () => {
        throw new Error("printing failure");
      },
    },
  },
];

describe("materialized mount cleanup", () => {
  it("records settled work before disposal queues a microtask", async () => {
    const runtime = await getRuntime();
    const timers = new TimerQueue();
    const Component = () => {
      runtime.react.useEffect(() => () => timers.queueMicrotask(() => {}), []);
      return runtime.react.createElement("span", null, "settled");
    };
    const mounted = await mountNode(
      runtime,
      createDomHost(false),
      runtime.react.createElement(Component),
      timers,
      () => {},
    );
    expect(mounted.hasPendingWork).toBe(false);
    expect(timers.hasMicrotasks()).toBe(true);
  });

  it("records bounded-out work before disposal cancels it", async () => {
    const runtime = await getRuntime();
    const timers = new TimerQueue();
    const handle = primitiveValue(1);
    const repeat = () => timers.schedule(handle, repeat);
    const Component = () => {
      runtime.react.useEffect(() => {
        repeat();
        return () => timers.clear(handle);
      }, []);
      return runtime.react.createElement("span", null, "pending");
    };
    const mounted = await mountNode(
      runtime,
      createDomHost(false),
      runtime.react.createElement(Component),
      timers,
      () => {},
    );
    expect(mounted.hasPendingWork).toBe(true);
    expect(timers.hasTasks()).toBe(false);
  });

  it.each(CASES)(
    "restores resources and preserves $name",
    async ({ hasRenderError, renderError }) => {
      const runtime = await getRuntime();
      const cleanupError = new Error("cleanup failure");
      let cleanupRoot = async (): Promise<void> => {};
      const failingRuntime: ReactRuntime = {
        ...runtime,
        createRoot: (container, callbacks) => {
          const mounted = runtime.createRoot(container, callbacks);
          const unmount = mounted.unmount.bind(mounted);
          cleanupRoot = async () => {
            await runtime.act(async () => unmount());
          };
          return {
            render: (node) => mounted.render(node),
            unmount: () => {
              unmount();
              throw cleanupError;
            },
          };
        },
      };
      const timers = new TimerQueue();
      if (hasRenderError) {
        vi.spyOn(timers, "runNextTask").mockImplementationOnce(() => {
          throw renderError;
        });
      }
      const host = createDomHost(false);
      const container = document.createElement("div");
      const detach = vi.fn();
      const originalError = console.error;
      const originalWarn = console.warn;
      try {
        let failure: unknown;
        try {
          await mountNode(
            failingRuntime,
            {
              ...host,
              createRootContainer: () => container,
              attachRootContainer: (element) => {
                const remove = host.attachRootContainer(element);
                return () => {
                  detach();
                  remove();
                };
              },
            },
            runtime.react.createElement("span", null, "rendered"),
            timers,
            () => {},
          );
        } catch (error) {
          failure = error;
        }
        if (hasRenderError) {
          expect(failure).toBeInstanceOf(AggregateError);
          if (failure instanceof AggregateError) {
            expect(failure.errors).toEqual([renderError, cleanupError]);
            expect(failure.errors[0]).toBe(renderError);
            expect(failure.errors[1]).toBe(cleanupError);
            expect(failure.message).toContain("cleanup failure");
          }
        } else {
          expect(failure).toBe(cleanupError);
        }
        expect(console.error).toBe(originalError);
        expect(console.warn).toBe(originalWarn);
        expect(detach).toHaveBeenCalledOnce();
        expect(container.isConnected).toBe(false);
      } finally {
        console.error = originalError;
        console.warn = originalWarn;
        await cleanupRoot();
        container.remove();
      }
    },
  );

  it("records an error React reports from the root while rendering", async () => {
    const runtime = await getRuntime();
    const failure = new Error("render boom");
    const Component = () => {
      throw failure;
    };
    const mounted = await mountNode(
      runtime,
      createDomHost(false),
      runtime.react.createElement(Component),
      new TimerQueue(),
      () => {},
    );
    expect(mounted.uncaughtErrors).toContain(failure);
  });

  it("records an error React reports through the root when the render is outside act", async () => {
    const runtime = await getRuntime();
    const internals = Reflect.get(
      runtime.react,
      "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
    );
    if (!isRecord(internals) || !("actQueue" in internals)) {
      throw new Error("React act queue is not observable");
    }
    const previousQueue = internals.actQueue;
    const failure = new Error("outside act");
    const Component = () => {
      // HACK: development React reports in-act render errors by rethrowing from act, and only calls onUncaughtError when actQueue is clear.
      internals.actQueue = null;
      throw failure;
    };
    try {
      const mounted = await mountNode(
        runtime,
        createDomHost(false),
        runtime.react.createElement(Component),
        new TimerQueue(),
        () => {},
      );
      expect(mounted.uncaughtErrors).toContain(failure);
    } finally {
      internals.actQueue = previousQueue;
    }
  });

  it("preserves a snapshot failure when unmount also fails", async () => {
    const runtime = await getRuntime();
    const snapshotError = new Error("snapshot failure");
    const cleanupError = new Error("cleanup failure");
    const createRecorder = commitRecorderModule.createCommitRecorder;
    const spy = vi
      .spyOn(commitRecorderModule, "createCommitRecorder")
      .mockImplementation((options) => {
        const recorder = createRecorder(options);
        return {
          ...recorder,
          snapshot: () => {
            throw snapshotError;
          },
        };
      });
    const failingRuntime: ReactRuntime = {
      ...runtime,
      createRoot: (container, callbacks) => {
        const mounted = runtime.createRoot(container, callbacks);
        return {
          render: (node) => mounted.render(node),
          unmount: () => {
            mounted.unmount();
            throw cleanupError;
          },
        };
      },
    };
    let failure: unknown;
    try {
      await mountNode(
        failingRuntime,
        createDomHost(false),
        runtime.react.createElement("span", null, "rendered"),
        new TimerQueue(),
        () => {},
      );
    } catch (error) {
      failure = error;
    } finally {
      spy.mockRestore();
    }
    expect(failure).toBeInstanceOf(AggregateError);
    if (failure instanceof AggregateError) {
      expect(failure.errors).toEqual([snapshotError, cleanupError]);
    }
  });
});
