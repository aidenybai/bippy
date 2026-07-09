// intentionally avoids importing ../index.js so this file controls hook installation
import { expect, it, vi } from "vitest";
import { getRDTHook, hasRDTHook, isClientEnvironment, patchRDTHook } from "../rdt-hook.js";
import type { ReactDevToolsGlobalHook, ReactRenderer } from "../types.js";

const createFakeRenderer = (): ReactRenderer =>
  ({
    bundleType: 1,
    version: "19.0.0",
  }) as unknown as ReactRenderer;

it("patchRDTHook should return early when no hook exists", () => {
  expect(hasRDTHook()).toBe(false);
  const onActive = vi.fn();
  patchRDTHook(onActive);
  expect(onActive).not.toHaveBeenCalled();
});

it("isClientEnvironment should detect react native environments", () => {
  expect(isClientEnvironment()).toBe(true);
  vi.stubGlobal("window", { navigator: { product: "ReactNative" } });
  expect(isClientEnvironment()).toBe(true);
  vi.stubGlobal("window", { navigator: { product: "Gecko" } });
  expect(isClientEnvironment()).toBe(false);
  vi.unstubAllGlobals();
});

it("getRDTHook should install the hook when missing", () => {
  const rdtHook = getRDTHook();
  expect(hasRDTHook()).toBe(true);
  expect(rdtHook.renderers.size).toBe(0);
  expect(rdtHook._instrumentationIsActive).toBe(false);
});

it("inject should activate instrumentation and notify listeners", () => {
  const onActive = vi.fn();
  const rdtHook = getRDTHook(onActive);
  expect(onActive).not.toHaveBeenCalled();
  const fakeRenderer = createFakeRenderer();
  const rendererId = rdtHook.inject(fakeRenderer);
  expect(rendererId).toBe(1);
  expect(rdtHook.renderers.get(rendererId)).toBe(fakeRenderer);
  expect(rdtHook._instrumentationIsActive).toBe(true);
  expect(onActive).toHaveBeenCalledTimes(1);
  const secondRendererId = rdtHook.inject(createFakeRenderer());
  expect(secondRendererId).toBe(2);
  expect(onActive).toHaveBeenCalledTimes(1);
});

it("checkDCE should schedule an error for badly built react", () => {
  const rdtHook = getRDTHook();
  vi.useFakeTimers();
  const productionMarkedFunction = () => "^_^";
  rdtHook.checkDCE(productionMarkedFunction);
  expect(() => vi.runAllTimers()).toThrow(/dead code/);
  rdtHook.checkDCE(() => "fine");
  expect(() => vi.runAllTimers()).not.toThrow();
  rdtHook.checkDCE(null);
  vi.useRealTimers();
});

it("window.hasOwnProperty hack should hide the hook exactly once", () => {
  expect(window.hasOwnProperty("someUnrelatedKey")).toBe(false);
  const firstResult = window.hasOwnProperty("__REACT_DEVTOOLS_GLOBAL_HOOK__");
  expect(Object.is(firstResult, -0)).toBe(true);
  const secondResult = window.hasOwnProperty("__REACT_DEVTOOLS_GLOBAL_HOOK__");
  expect(Object.is(secondResult, -0)).toBe(false);
  expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
});

it("assigning a new hook should merge existing renderers into it", () => {
  const onActive = vi.fn();
  getRDTHook(onActive);
  const callCountBeforeReplacement = onActive.mock.calls.length;
  const replacementHook: ReactDevToolsGlobalHook = {
    checkDCE: () => {},
    hasUnsupportedRendererAttached: false,
    inject: () => 0,
    on: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map<number, ReactRenderer>(),
    supportsFiber: true,
    supportsFlight: true,
  };
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacementHook;
  expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(replacementHook);
  expect(replacementHook.renderers.size).toBe(2);
  expect(replacementHook._instrumentationIsActive).toBe(true);
  expect(onActive.mock.calls.length).toBeGreaterThan(callCountBeforeReplacement);
});
