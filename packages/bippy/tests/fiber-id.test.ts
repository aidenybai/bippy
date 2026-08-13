import { expect, it } from "vite-plus/test";
import { getFiberId, setFiberId } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { createFiber } from "./create-fiber.js";

const createFiberWithAlternate = (alternate: Fiber | null = null): Fiber =>
  createFiber({ alternate });

it("should assign a stable auto-incremented id", () => {
  const fiber = createFiberWithAlternate();
  setFiberId(fiber);
  const assignedId = getFiberId(fiber);
  expect(assignedId).toBeTypeOf("number");
  expect(getFiberId(fiber)).toBe(assignedId);
});

it("should honor an explicitly assigned id", () => {
  const fiber = createFiberWithAlternate();
  setFiberId(fiber, 12_345);
  expect(getFiberId(fiber)).toBe(12_345);
});

it("should advance generated ids past explicitly assigned ids", () => {
  const explicitFiber = createFiberWithAlternate();
  const generatedFiber = createFiberWithAlternate();
  setFiberId(explicitFiber, 1_000_000_000);
  setFiberId(generatedFiber);
  expect(getFiberId(generatedFiber)).toBeGreaterThan(1_000_000_000);
});

it("should reuse the id of the alternate fiber", () => {
  const currentFiber = createFiberWithAlternate();
  setFiberId(currentFiber, 0);
  const alternateFiber = createFiberWithAlternate(currentFiber);
  expect(getFiberId(alternateFiber)).toBe(0);
});
