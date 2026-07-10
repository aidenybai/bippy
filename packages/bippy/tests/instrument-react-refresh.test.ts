import { expect, it, vi } from "vitest";
import { PENDING_HOT_UPDATE_MAX_AGE_MS } from "../src/react-refresh/constants.js";
import { instrumentReactRefresh } from "../src/react-refresh/index.js";
import { getRDTHook } from "../src/rdt-hook.js";
import type { FiberRoot, ReactRenderer, RendererRefreshUpdate } from "../src/types.js";

const createFakeRefreshRenderer = (scheduleRefresh = vi.fn()): ReactRenderer =>
  ({
    bundleType: 1,
    scheduleRefresh,
    setRefreshHandler: vi.fn(),
    version: "19.0.0",
  }) as unknown as ReactRenderer;

const UpdatedComponent = () => null;
const StaleComponent = () => null;

const createFakeRendererUpdate = (): RendererRefreshUpdate => ({
  staleFamilies: new Set([{ current: StaleComponent }]),
  updatedFamilies: new Set([{ current: UpdatedComponent }]),
});

const fakeRoot = {} as FiberRoot;

it("reports updated and stale component types after the original scheduleRefresh runs", () => {
  const rdtHook = getRDTHook();
  const callOrder: string[] = [];
  const originalScheduleRefresh = vi.fn(() => callOrder.push("original"));
  const fakeRenderer = createFakeRefreshRenderer(originalScheduleRefresh);
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn(() => callOrder.push("handler"));
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  expect(typeof unsubscribe).toBe("function");

  const rendererUpdate = createFakeRendererUpdate();
  fakeRenderer.scheduleRefresh?.(fakeRoot, rendererUpdate);

  expect(originalScheduleRefresh).toHaveBeenCalledWith(fakeRoot, rendererUpdate);
  expect(onRefreshUpdate).toHaveBeenCalledWith({
    filePaths: [],
    root: fakeRoot,
    staleComponents: [StaleComponent],
    staleFibers: [],
    updatedComponents: [UpdatedComponent],
    updatedFibers: [],
  });
  expect(callOrder).toEqual(["original", "handler"]);
  unsubscribe();
});

it("patches renderers injected after the listener was created", () => {
  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);

  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());

  expect(onRefreshUpdate).toHaveBeenCalledOnce();
  unsubscribe();
});

it("ignores renderers without scheduleRefresh", () => {
  const rdtHook = getRDTHook();
  const rendererWithoutRefresh = { bundleType: 1, version: "19.0.0" } as unknown as ReactRenderer;
  rdtHook.inject(rendererWithoutRefresh);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  expect(rendererWithoutRefresh.scheduleRefresh).toBeUndefined();
  unsubscribe();
});

it("unsubscribe stops the handler while the wrapper keeps forwarding to the original", () => {
  const rdtHook = getRDTHook();
  const originalScheduleRefresh = vi.fn();
  const fakeRenderer = createFakeRefreshRenderer(originalScheduleRefresh);
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  unsubscribe();

  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());
  expect(onRefreshUpdate).not.toHaveBeenCalled();
  expect(originalScheduleRefresh).toHaveBeenCalledOnce();
});

it("stops invoking the handler after unsubscribe even if the patch was layered over", () => {
  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);

  const patchedScheduleRefresh = fakeRenderer.scheduleRefresh;
  fakeRenderer.scheduleRefresh = (root, update) => patchedScheduleRefresh?.(root, update);

  unsubscribe();
  fakeRenderer.scheduleRefresh(fakeRoot, createFakeRendererUpdate());
  expect(onRefreshUpdate).not.toHaveBeenCalled();
});

it("the unsubscribe is a Disposable that removes the handler", () => {
  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  unsubscribe[Symbol.dispose]();

  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());
  expect(onRefreshUpdate).not.toHaveBeenCalled();
});

it("returns a no-op unsubscribe in non-client environments", () => {
  vi.stubGlobal("window", { navigator: { product: "Gecko" } });
  const unsubscribe = instrumentReactRefresh(vi.fn());
  expect(typeof unsubscribe).toBe("function");
  expect(() => unsubscribe()).not.toThrow();
  vi.unstubAllGlobals();
});

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("collects the mounted fibers whose component types were hot-swapped", () => {
  const updatedFiber = { child: null, return: null, sibling: null, type: UpdatedComponent };
  const staleFiber = { child: null, return: null, sibling: updatedFiber, type: StaleComponent };
  const hostFiber = { child: staleFiber, return: null, sibling: null, type: "div" };
  const rootWithTree = { current: { child: hostFiber, return: null, sibling: null, type: null } };

  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);

  fakeRenderer.scheduleRefresh?.(rootWithTree as unknown as FiberRoot, createFakeRendererUpdate());

  expect(onRefreshUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      staleFibers: [staleFiber],
      updatedFibers: [updatedFiber],
    }),
  );
  unsubscribe();
});

it("augments refresh updates with file paths from the detected hmr transport", async () => {
  const originalHotUpdate = vi.fn();
  window.webpackHotUpdate_N_E = originalHotUpdate;

  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  await flushMicrotasks();

  window.webpackHotUpdate_N_E?.("chunk", { "(app-pages-browser)/./app/page.tsx": {} }, undefined);
  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());

  expect(onRefreshUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ filePaths: ["app/page.tsx"] }),
  );
  expect(originalHotUpdate).toHaveBeenCalledOnce();

  unsubscribe();
  delete window.webpackHotUpdate_N_E;
});

it("shares pending file paths across roots in one refresh pass, then clears them", async () => {
  window.webpackHotUpdate_N_E = vi.fn();

  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  await flushMicrotasks();

  window.webpackHotUpdate_N_E?.("chunk", { "./app/card.tsx": {} }, undefined);
  const firstRoot = {} as FiberRoot;
  const secondRoot = {} as FiberRoot;
  fakeRenderer.scheduleRefresh?.(firstRoot, createFakeRendererUpdate());
  fakeRenderer.scheduleRefresh?.(secondRoot, createFakeRendererUpdate());

  expect(onRefreshUpdate).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ filePaths: ["app/card.tsx"], root: firstRoot }),
  );
  expect(onRefreshUpdate).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ filePaths: ["app/card.tsx"], root: secondRoot }),
  );

  await flushMicrotasks();
  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());
  expect(onRefreshUpdate).toHaveBeenNthCalledWith(3, expect.objectContaining({ filePaths: [] }));

  unsubscribe();
  delete window.webpackHotUpdate_N_E;
});

it("drops pending file paths older than the freshness window", async () => {
  vi.useFakeTimers();
  window.webpackHotUpdate_N_E = vi.fn();

  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const unsubscribe = instrumentReactRefresh(onRefreshUpdate);
  await vi.runOnlyPendingTimersAsync();

  window.webpackHotUpdate_N_E?.("chunk", { "./app/stale.tsx": {} }, undefined);
  vi.advanceTimersByTime(PENDING_HOT_UPDATE_MAX_AGE_MS + 1);
  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());

  expect(onRefreshUpdate).toHaveBeenCalledWith(expect.objectContaining({ filePaths: [] }));

  unsubscribe();
  delete window.webpackHotUpdate_N_E;
  vi.useRealTimers();
});
