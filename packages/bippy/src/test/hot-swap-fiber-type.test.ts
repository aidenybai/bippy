import "../index.js"; // KEEP THIS LINE ON TOP

import { expect, it, vi } from "vitest";
import { hotSwapFiberType } from "../index.js";
import type { Fiber, ReactDevToolsGlobalHook, ReactRenderer } from "../types.js";

interface MockFiberOverrides {
  alternate?: Fiber | null;
  child?: Fiber | null;
  memoizedProps?: Record<string, unknown>;
  return?: Fiber | null;
  sibling?: Fiber | null;
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

const NextComponent = () => null;

it("should do nothing when there is no rdt hook", () => {
  delete globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const fiber = createMockFiber({ type: "div" });
  hotSwapFiberType(fiber, NextComponent);
  expect(fiber.type).toBe("div");
});

it("should do nothing when no renderer supports scheduleUpdate", () => {
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, {} as unknown as ReactRenderer]]),
  } as unknown as ReactDevToolsGlobalHook;
  const fiber = createMockFiber({ type: "div" });
  hotSwapFiberType(fiber, NextComponent);
  expect(fiber.type).toBe("div");
});

it("should swap the fiber directly when the previous type is not resolvable", () => {
  const scheduleUpdate = vi.fn();
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { scheduleUpdate } as unknown as ReactRenderer]]),
  } as unknown as ReactDevToolsGlobalHook;
  const alternateFiber = createMockFiber({ type: "div" });
  const originalProps = { count: 1 };
  const fiber = createMockFiber({
    alternate: alternateFiber,
    memoizedProps: originalProps,
    type: "div",
  });
  hotSwapFiberType(fiber, NextComponent);
  expect(fiber.type).toBe(NextComponent);
  expect(alternateFiber.type).toBe(NextComponent);
  expect(fiber.memoizedProps).not.toBe(originalProps);
  expect(fiber.memoizedProps).toEqual(originalProps);
  expect(scheduleUpdate).toHaveBeenCalledWith(fiber);
});

it("should swap every fiber in the tree with a matching type", () => {
  const scheduleUpdate = vi.fn();
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { scheduleUpdate } as unknown as ReactRenderer]]),
  } as unknown as ReactDevToolsGlobalHook;
  const PrevComponent = () => null;
  const OtherComponent = () => null;
  const rootFiber = createMockFiber({ type: null });
  const firstMatch = createMockFiber({ return: rootFiber, type: PrevComponent });
  const otherFiber = createMockFiber({ return: rootFiber, type: OtherComponent });
  const secondMatch = createMockFiber({ return: rootFiber, type: PrevComponent });
  firstMatch.sibling = otherFiber;
  otherFiber.sibling = secondMatch;
  rootFiber.child = firstMatch;
  hotSwapFiberType(firstMatch, NextComponent);
  expect(firstMatch.type).toBe(NextComponent);
  expect(secondMatch.type).toBe(NextComponent);
  expect(otherFiber.type).toBe(OtherComponent);
  expect(scheduleUpdate).toHaveBeenCalledTimes(2);
});
