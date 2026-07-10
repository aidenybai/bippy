import { expect, it } from "vitest";
import { hasMemoCache } from "../src/index.js";
import type { Fiber } from "../src/types.js";

const createMockFiber = (updateQueue: unknown): Fiber =>
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
    updateQueue,
  }) as unknown as Fiber;

it("should return true when the update queue has a memo cache", () => {
  expect(hasMemoCache(createMockFiber({ memoCache: { data: [], index: 0 } }))).toBe(true);
});

it("should return false when there is no memo cache", () => {
  expect(hasMemoCache(createMockFiber({}))).toBe(false);
  expect(hasMemoCache(createMockFiber(null))).toBe(false);
});
