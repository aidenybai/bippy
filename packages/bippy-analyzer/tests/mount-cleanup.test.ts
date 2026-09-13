import { resolve } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { TimerQueue } from "../src/evaluate/timers.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { mountNode } from "../src/materialize/mount.js";
import { loadReactRuntime, type ReactRuntime } from "../src/materialize/react-runtime.js";
import { createDomHost } from "../src/render/dom-host.js";

interface FailureCase {
  name: string;
  hasRenderError: boolean;
  renderError?: unknown;
}

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
  it.each(CASES)(
    "restores resources and preserves $name",
    async ({ hasRenderError, renderError }) => {
      const rootDirectory = resolve(import.meta.dirname, "..");
      const runtime = await loadReactRuntime({
        rootDirectory,
        resolver: new ModuleResolver({ rootDirectory }),
      });
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
      const container = host.createContainer();
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
              createContainer: () => container,
              attachContainer: (element) => {
                const remove = host.attachContainer(element);
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
});
