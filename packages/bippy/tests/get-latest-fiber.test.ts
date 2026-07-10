import { afterEach, expect, it } from "vitest";
import { _fiberRoots, getLatestFiber } from "../src/index.js";
import type { Fiber } from "../src/types.js";

interface MockFiberOverrides {
  actualStartTime?: number;
  alternate?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  ({
    actualStartTime: 0,
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
    ...overrides,
  }) as unknown as Fiber;

afterEach(() => {
  _fiberRoots.clear();
});

it("should return the fiber when it has no alternate", () => {
  const fiber = createMockFiber();
  expect(getLatestFiber(fiber)).toBe(fiber);
});

it("should return whichever of the pair started rendering last", () => {
  const olderFiber = createMockFiber({ actualStartTime: 1 });
  const newerFiber = createMockFiber({ actualStartTime: 2 });
  olderFiber.alternate = newerFiber;
  newerFiber.alternate = olderFiber;
  expect(getLatestFiber(olderFiber)).toBe(newerFiber);
  expect(getLatestFiber(newerFiber)).toBe(newerFiber);
});

it("should find the fiber in a tracked fiber root when start times are missing", () => {
  const alternateFiber = createMockFiber();
  const fiber = createMockFiber({ alternate: alternateFiber });
  const rootFiber = createMockFiber({ child: fiber });
  _fiberRoots.add({ current: rootFiber });
  expect(getLatestFiber(fiber)).toBe(fiber);
});

it("should fall back to the given fiber when no root contains it", () => {
  const alternateFiber = createMockFiber();
  const fiber = createMockFiber({ alternate: alternateFiber });
  _fiberRoots.add({ current: createMockFiber() });
  expect(getLatestFiber(fiber)).toBe(fiber);
});
