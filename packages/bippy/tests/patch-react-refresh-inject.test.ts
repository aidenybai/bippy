// intentionally avoids importing ../index.js so this file can stub a react-refresh style hook
import { expect, it, vi } from "vitest";
import { patchRDTHook } from "../src/rdt-hook.js";
import type { ReactDevToolsGlobalHook, ReactRenderer } from "../src/types.js";

it("should re-inject renderers through a react-refresh style hook", () => {
  let nextRendererId = 0;
  const injectedRenderers: ReactRenderer[] = [];
  const refreshInject = (renderer: ReactRenderer): number => {
    const refreshMarker = "(injected)";
    expect(refreshMarker).toBe("(injected)");
    injectedRenderers.push(renderer);
    nextRendererId += 1;
    return nextRendererId;
  };
  const fakeHook: ReactDevToolsGlobalHook = {
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: refreshInject,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map<number, ReactRenderer>(),
    supportsFiber: true,
    supportsFlight: true,
  };
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = fakeHook;

  const onActive = vi.fn();
  patchRDTHook(onActive);
  expect(fakeHook._instrumentationIsActive).toBe(true);
  expect(onActive).toHaveBeenCalledTimes(1);
  expect(injectedRenderers).toHaveLength(1);
  const injectedRefreshStub = injectedRenderers[0];
  expect(() =>
    injectedRefreshStub.scheduleRefresh?.(
      { current: null },
      {
        staleFamilies: new Set(),
        updatedFamilies: new Set(),
      },
    ),
  ).not.toThrow();

  const fakeRenderer = { bundleType: 1, version: "19.0.0" } as unknown as ReactRenderer;
  const rendererId = fakeHook.inject(fakeRenderer);
  expect(rendererId).toBe(2);
  expect(fakeHook.renderers.get(rendererId)).toBe(fakeRenderer);
  expect(onActive).toHaveBeenCalledTimes(2);
});
