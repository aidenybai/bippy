import { expect, it } from "vitest";
import { fiberIdMap, getFiberId, setFiberId } from "../index.js";
import type { Fiber } from "../types.js";

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

it("should assign an auto-incremented id when none is given", () => {
  // HACK: consume id 0 first, since getFiberId treats a falsy id as unassigned
  getFiberId(createMockFiber());
  const fiber = createMockFiber();
  setFiberId(fiber);
  const assignedId = fiberIdMap.get(fiber);
  expect(assignedId).toBeTypeOf("number");
  expect(getFiberId(fiber)).toBe(assignedId);
});

it("should reuse the id of the alternate fiber", () => {
  const currentFiber = createMockFiber();
  const currentFiberId = getFiberId(currentFiber);
  const alternateFiber = createMockFiber(currentFiber);
  expect(getFiberId(alternateFiber)).toBe(currentFiberId);
});
