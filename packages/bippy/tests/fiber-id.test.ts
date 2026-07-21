import { expect, it } from "vitest";
import { getFiberId, setFiberId } from "../src/index.js";
import type { Fiber } from "../src/types.js";

const createMockFiber = (alternate: Fiber | null = null): Fiber =>
  ({
    alternate,
    child: null,
    flags: 0,
    return: null,
    sibling: null,
    stateNode: null,
    tag: 0,
    type: null,
  }) as unknown as Fiber;

it("should assign a stable auto-incremented id", () => {
  const fiber = createMockFiber();
  setFiberId(fiber);
  const assignedId = getFiberId(fiber);
  expect(assignedId).toBeTypeOf("number");
  expect(getFiberId(fiber)).toBe(assignedId);
});

it("should honor an explicitly assigned id", () => {
  const fiber = createMockFiber();
  setFiberId(fiber, 12_345);
  expect(getFiberId(fiber)).toBe(12_345);
});

it("should reuse the id of the alternate fiber", () => {
  const currentFiber = createMockFiber();
  setFiberId(currentFiber, 0);
  const alternateFiber = createMockFiber(currentFiber);
  expect(getFiberId(alternateFiber)).toBe(0);
});
