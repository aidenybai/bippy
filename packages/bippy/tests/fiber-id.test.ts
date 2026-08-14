import { expect, it } from "vite-plus/test";
import { getFiberId, setFiberId } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

const createMockFiber = (alternate: Fiber | null = null): Fiber =>
  ({
    alternate,
    child: null,
    flags: 0,
    return: null,
    sibling: null,
    stateNode: null,
    tag: latestReactWorkTags.FunctionComponent,
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

it("should advance generated ids past explicitly assigned ids", () => {
  const explicitFiber = createMockFiber();
  const generatedFiber = createMockFiber();
  setFiberId(explicitFiber, 1_000_000_000);
  setFiberId(generatedFiber);
  expect(getFiberId(generatedFiber)).toBeGreaterThan(1_000_000_000);
});

it("should reuse the id of the alternate fiber", () => {
  const currentFiber = createMockFiber();
  setFiberId(currentFiber, 0);
  const alternateFiber = createMockFiber(currentFiber);
  expect(getFiberId(alternateFiber)).toBe(0);
});
