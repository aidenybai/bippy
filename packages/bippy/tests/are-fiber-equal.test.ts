import { expect, it } from "vitest";
import { areFiberEqual } from "../src/index.js";
import type { Fiber } from "../src/types.js";

const createMockFiber = (): Fiber =>
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
    type: null,
  }) as unknown as Fiber;

it("should return true for the same fiber reference", () => {
  const fiber = createMockFiber();
  expect(areFiberEqual(fiber, fiber)).toBe(true);
});

it("should return true when one fiber is the alternate of the other", () => {
  const currentFiber = createMockFiber();
  const alternateFiber = createMockFiber();
  currentFiber.alternate = alternateFiber;
  expect(areFiberEqual(currentFiber, alternateFiber)).toBe(true);
  expect(areFiberEqual(alternateFiber, currentFiber)).toBe(true);
});

it("should return false for unrelated fibers", () => {
  expect(areFiberEqual(createMockFiber(), createMockFiber())).toBe(false);
});
