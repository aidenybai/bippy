import { expect, it, vi } from "vitest";
import { onReactRefresh } from "../src/react-refresh/index.js";
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
  const listener = onReactRefresh(onRefreshUpdate);
  expect(listener).not.toBeNull();

  const rendererUpdate = createFakeRendererUpdate();
  fakeRenderer.scheduleRefresh?.(fakeRoot, rendererUpdate);

  expect(originalScheduleRefresh).toHaveBeenCalledWith(fakeRoot, rendererUpdate);
  expect(onRefreshUpdate).toHaveBeenCalledWith({
    root: fakeRoot,
    staleComponents: [StaleComponent],
    updatedComponents: [UpdatedComponent],
  });
  expect(callOrder).toEqual(["original", "handler"]);
  listener?.dispose();
});

it("patches renderers injected after the listener was created", () => {
  const onRefreshUpdate = vi.fn();
  const listener = onReactRefresh(onRefreshUpdate);

  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());

  expect(onRefreshUpdate).toHaveBeenCalledOnce();
  listener?.dispose();
});

it("ignores renderers without scheduleRefresh", () => {
  const rdtHook = getRDTHook();
  const rendererWithoutRefresh = { bundleType: 1, version: "19.0.0" } as unknown as ReactRenderer;
  rdtHook.inject(rendererWithoutRefresh);

  const onRefreshUpdate = vi.fn();
  const listener = onReactRefresh(onRefreshUpdate);
  expect(rendererWithoutRefresh.scheduleRefresh).toBeUndefined();
  listener?.dispose();
});

it("dispose restores the original scheduleRefresh and inject", () => {
  const rdtHook = getRDTHook();
  const originalScheduleRefresh = vi.fn();
  const fakeRenderer = createFakeRefreshRenderer(originalScheduleRefresh);
  rdtHook.inject(fakeRenderer);
  const injectBeforeListener = rdtHook.inject;

  const onRefreshUpdate = vi.fn();
  const listener = onReactRefresh(onRefreshUpdate);
  expect(fakeRenderer.scheduleRefresh).not.toBe(originalScheduleRefresh);
  expect(rdtHook.inject).not.toBe(injectBeforeListener);

  listener?.dispose();
  expect(fakeRenderer.scheduleRefresh).toBe(originalScheduleRefresh);
  expect(rdtHook.inject).toBe(injectBeforeListener);

  fakeRenderer.scheduleRefresh?.(fakeRoot, createFakeRendererUpdate());
  expect(onRefreshUpdate).not.toHaveBeenCalled();
});

it("stops invoking the handler after dispose even if the patch was layered over", () => {
  const rdtHook = getRDTHook();
  const fakeRenderer = createFakeRefreshRenderer();
  rdtHook.inject(fakeRenderer);

  const onRefreshUpdate = vi.fn();
  const listener = onReactRefresh(onRefreshUpdate);

  const patchedScheduleRefresh = fakeRenderer.scheduleRefresh;
  fakeRenderer.scheduleRefresh = (root, update) => patchedScheduleRefresh?.(root, update);

  listener?.dispose();
  fakeRenderer.scheduleRefresh(fakeRoot, createFakeRendererUpdate());
  expect(onRefreshUpdate).not.toHaveBeenCalled();
});

it("returns null in non-client environments", () => {
  vi.stubGlobal("window", { navigator: { product: "Gecko" } });
  expect(onReactRefresh(vi.fn())).toBeNull();
  vi.unstubAllGlobals();
});
