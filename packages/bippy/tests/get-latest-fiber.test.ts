import { afterEach, expect, it } from "vite-plus/test";
import { _fiberRoots, getLatestFiber } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { createFiber } from "./create-fiber.js";

interface MockFiberOverrides {
  actualStartTime?: number;
  alternate?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
}

const createMockFiber = (overrides: MockFiberOverrides = {}): Fiber =>
  createFiber({ actualStartTime: 0, ...overrides });

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

it("should find the alternate in a tracked fiber root when the given fiber is stale", () => {
  const staleFiber = createMockFiber();
  const currentFiber = createMockFiber({ alternate: staleFiber });
  staleFiber.alternate = currentFiber;
  const rootFiber = createMockFiber({ child: currentFiber });
  _fiberRoots.add({ current: rootFiber });
  expect(getLatestFiber(staleFiber)).toBe(currentFiber);
});

it("should fall back to the given fiber when no root contains it", () => {
  const alternateFiber = createMockFiber();
  const fiber = createMockFiber({ alternate: alternateFiber });
  _fiberRoots.add({ current: createMockFiber() });
  expect(getLatestFiber(fiber)).toBe(fiber);
});
