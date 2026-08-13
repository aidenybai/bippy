import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { expect, it, vi } from "vite-plus/test";
import { overrideContext, overrideHookState, overrideProps } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { createFiber } from "./create-fiber.js";
import { createRDTHook } from "./create-rdt-hook.js";
import { createReactRenderer } from "./create-react-renderer.js";

interface MockFiberOverrides {
  alternate?: Fiber | null;
  memoizedState?: unknown;
  return?: Fiber | null;
  type?: unknown;
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  createFiber({ type: () => null, ...overrides });

const firstOverrideProps = vi.fn();
const firstOverrideHookState = vi.fn();
const secondOverrideProps = vi.fn();
const secondOverrideHookState = vi.fn();
const firstRenderer = createReactRenderer({
  overrideHookState: firstOverrideHookState,
  overrideProps: firstOverrideProps,
});
const secondRenderer = createReactRenderer({
  overrideHookState: secondOverrideHookState,
  overrideProps: secondOverrideProps,
});

it("should no-op when no rdt hook exists", () => {
  delete globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  expect(() => overrideProps(createMockFiber(), { count: 1 })).not.toThrow();
  expect(firstOverrideProps).not.toHaveBeenCalled();
});

it("should no-op when the hook has no renderers", () => {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createRDTHook({
    _instrumentationSource: "test",
  });
  expect(() => overrideProps(createMockFiber(), { count: 1 })).not.toThrow();
  expect(firstOverrideProps).not.toHaveBeenCalled();
});

it("should chain override methods from every renderer", () => {
  const rendererWithoutOverrides = createReactRenderer();
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createRDTHook({
    _instrumentationSource: "test",
    renderers: new Map([
      [1, rendererWithoutOverrides],
      [2, firstRenderer],
      [3, secondRenderer],
    ]),
  });

  const fiber = createMockFiber();
  overrideProps(fiber, { count: 1, nested: { value: 2 } });
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, ["count"], 1);
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, ["nested", "value"], 2);
  expect(secondOverrideProps).toHaveBeenCalledWith(fiber, ["count"], 1);
});

it("should stop descending when override values contain cycles", () => {
  const fiber = createMockFiber();
  const cyclicValue: Record<string, unknown> = { count: 1 };
  cyclicValue.self = cyclicValue;
  overrideProps(fiber, cyclicValue);
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, ["count"], 1);
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, ["self"], cyclicValue);
});

it("should treat non-plain-object props as a single value", () => {
  const fiber = createMockFiber();
  const exoticValue = Object.create(Object.create(null));
  overrideProps(fiber, exoticValue);
  expect(firstOverrideProps).toHaveBeenCalledWith(fiber, [], exoticValue);
});

it("should prefer renderer overrideHookState over the hook queue dispatch", () => {
  const dispatch = vi.fn();
  const fiber = createMockFiber({
    memoizedState: { next: { queue: { dispatch } } },
  });
  overrideHookState(fiber, 1, { value: 5 });
  expect(dispatch).not.toHaveBeenCalled();
  expect(firstOverrideHookState).toHaveBeenCalledWith(fiber, 1, ["value"], 5);
  expect(secondOverrideHookState).toHaveBeenCalledWith(fiber, 1, ["value"], 5);
});

it("should apply path writes through every capable renderer", () => {
  const fiber = createMockFiber({ memoizedState: { queue: {} } });
  overrideHookState(fiber, 0, { value: 5 });
  expect(firstOverrideHookState).toHaveBeenCalledWith(fiber, 0, ["value"], 5);
  expect(secondOverrideHookState).toHaveBeenCalledWith(fiber, 0, ["value"], 5);
});

it("should treat non-plain-object hook state as a single value", () => {
  const fiber = createMockFiber();
  const exoticValue = Object.create(Object.create(null));
  overrideHookState(fiber, 0, exoticValue);
  expect(firstOverrideHookState).toHaveBeenCalledWith(fiber, 0, [], exoticValue);
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
