import "../index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vitest";
import {
  injectOverrideMethods,
  overrideContext,
  overrideHookState,
  overrideProps,
} from "../index.js";
import type { Fiber, ReactDevToolsGlobalHook, ReactRenderer } from "../types.js";

interface MockFiberOverrides {
  alternate?: Fiber | null;
  memoizedState?: unknown;
  return?: Fiber | null;
  type?: unknown;
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  ({
    alternate: null,
    child: null,
    flags: 0,
    memoizedProps: {},
    memoizedState: null,
    pendingProps: {},
    return: null,
    sibling: null,
    stateNode: null,
    tag: 0,
    type: () => null,
    ...overrides,
  }) as unknown as Fiber;

const firstOverrideProps = vi.fn();
const firstOverrideHookState = vi.fn();
const secondOverrideProps = vi.fn();
const secondOverrideHookState = vi.fn();
const firstRenderer = {
  overrideHookState: firstOverrideHookState,
  overrideProps: firstOverrideProps,
} as unknown as ReactRenderer;
const secondRenderer = {
  overrideHookState: secondOverrideHookState,
  overrideProps: secondOverrideProps,
} as unknown as ReactRenderer;

it("should return null when no rdt hook exists", () => {
  delete globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  expect(injectOverrideMethods()).toBe(null);
});

it("should return null when the hook has no renderers", () => {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    _instrumentationSource: "test",
  } as unknown as ReactDevToolsGlobalHook;
  expect(injectOverrideMethods()).toBe(null);
});

it("should chain override methods from every renderer", () => {
  const rendererWithoutOverrides = {} as unknown as ReactRenderer;
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    _instrumentationSource: "test",
    renderers: new Map([
      [1, rendererWithoutOverrides],
      [2, firstRenderer],
      [3, secondRenderer],
    ]),
  } as unknown as ReactDevToolsGlobalHook;

  const fiber = createMockFiber();
  overrideProps(fiber, { count: 1, nested: { value: 2 } });
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, ["count"], 1);
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, ["nested", "value"], 2);
  expect(secondOverrideProps).toHaveBeenCalledWith(fiber, ["count"], 1);
});

it("should return the cached override methods on subsequent calls", () => {
  const overrideMethods = injectOverrideMethods();
  expect(overrideMethods?.overrideProps).toBeTypeOf("function");
  expect(overrideMethods?.overrideHookState).toBeTypeOf("function");
  expect(overrideMethods?.overrideContext).toBeTypeOf("function");
});

it("should treat non-plain-object props as a single value", () => {
  const fiber = createMockFiber();
  const exoticValue = Object.create(Object.create(null));
  overrideProps(fiber, exoticValue);
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, [], exoticValue);
});

it("should dispatch through the hook queue when available", () => {
  const dispatch = vi.fn();
  const fiber = createMockFiber({
    memoizedState: { next: { queue: { dispatch } } },
  });
  overrideHookState(fiber, 1, { value: 5 });
  expect(dispatch).toHaveBeenCalledWith(5);
});

it("should fall back to renderer overrideHookState when there is no dispatch", () => {
  const fiber = createMockFiber({ memoizedState: { queue: {} } });
  overrideHookState(fiber, 0, { value: 5 });
  expect(firstOverrideHookState).toHaveBeenCalledWith(fiber, "0", ["value"], 5);
  expect(secondOverrideHookState).toHaveBeenCalledWith(fiber, "0", ["value"], 5);
});

it("should stop walking hook states when the chain ends", () => {
  const fiber = createMockFiber({ memoizedState: { next: null } });
  overrideHookState(fiber, 3, { value: 5 });
  expect(firstOverrideHookState).toHaveBeenCalledWith(fiber, "3", ["value"], 5);
});

it("should treat non-plain-object hook state as a single value", () => {
  const fiber = createMockFiber();
  const exoticValue = Object.create(Object.create(null));
  overrideHookState(fiber, 0, exoticValue);
  expect(firstOverrideHookState).toHaveBeenCalledWith(fiber, "0", [], exoticValue);
});

it("should override context values on the matching provider fiber", () => {
  const contextType = { displayName: "TestContext" };
  const providerFiber = createMockFiber({ type: contextType });
  const providerAlternate = createMockFiber({ type: contextType });
  providerFiber.alternate = providerAlternate;
  const childFiber = createMockFiber({ return: providerFiber });
  overrideContext(childFiber, contextType, { theme: "dark" });
  expect(firstOverrideProps).toHaveBeenCalledWith(providerFiber, ["value", "theme"], "dark");
  expect(firstOverrideProps).toHaveBeenCalledWith(providerAlternate, ["value", "theme"], "dark");
});

it("should match providers via the Provider property", () => {
  const contextType = { displayName: "TestContext" };
  const providerFiber = createMockFiber({ type: { Provider: contextType } });
  overrideContext(providerFiber, contextType, { theme: "light" });
  expect(firstOverrideProps).toHaveBeenCalledWith(providerFiber, ["value", "theme"], "light");
});

it("should do nothing when no provider matches", () => {
  const overridePropsCallCount = firstOverrideProps.mock.calls.length;
  const orphanFiber = createMockFiber();
  overrideContext(orphanFiber, { displayName: "MissingContext" }, { theme: "dark" });
  expect(firstOverrideProps.mock.calls.length).toBe(overridePropsCallCount);
});

it("should treat non-plain-object context values as a single value", () => {
  const contextType = { displayName: "TestContext" };
  const providerFiber = createMockFiber({ type: contextType });
  const exoticValue = Object.create(Object.create(null));
  overrideContext(providerFiber, contextType, exoticValue);
  expect(firstOverrideProps).toHaveBeenCalledWith(providerFiber, ["value"], exoticValue);
});
