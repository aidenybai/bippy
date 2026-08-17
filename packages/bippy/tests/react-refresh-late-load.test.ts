// intentionally imports bippy dynamically so react-refresh's hook can be
// simulated before bippy loads (the Vite/Next dev late-load path)
import { expect, it, vi } from "vite-plus/test";
import type { ReactDevToolsGlobalHook, ReactRenderer } from "../src/react-internals/index.js";

// mirrors injectIntoGlobalHook in react-refresh/src/ReactFreshRuntime.js:
// inject only increments a counter (renderers are never recorded in the
// renderers map) and the wrapper's parameter is named "injected"
const createReactRefreshHook = (): ReactDevToolsGlobalHook => {
  let nextRendererId = 0;
  const hook: ReactDevToolsGlobalHook = {
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: () => nextRendererId++,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    onScheduleFiberRoot: () => {},
    renderers: new Map<number, ReactRenderer>(),
    supportsFiber: true,
    supportsFlight: true,
  };
  const previousInject = hook.inject;
  hook.inject = (injected) => previousInject(injected);
  return hook;
};

const createRenderer = (): ReactRenderer => ({
  bundleType: 1,
  rendererPackageName: "react-dom",
  version: "19.1.0",
});

it("activates when bippy loads after React injected into a react-refresh hook", async () => {
  const hook = createReactRefreshHook();
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  hook.inject(createRenderer());
  expect(hook.renderers.size).toBe(0);

  const { instrument, isInstrumentationActive } = await import("../src/index.js");
  const onActive = vi.fn();
  instrument({ onActive });

  expect(onActive).toHaveBeenCalledOnce();
  expect(isInstrumentationActive()).toBe(true);
  expect(hook._instrumentationIsActive).toBe(true);

  const lateRenderer = createRenderer();
  const lateRendererId = hook.inject(lateRenderer);
  expect(hook.renderers.get(lateRendererId)).toBe(lateRenderer);
});
