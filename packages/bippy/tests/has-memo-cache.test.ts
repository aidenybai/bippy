import { expect, it } from "vite-plus/test";
import { hasMemoCache } from "../src/index.js";
import { createFiber } from "./create-fiber.js";

const createFiberWithUpdateQueue = (updateQueue: unknown) => createFiber({ updateQueue });

it("should return true when the update queue has a memo cache", () => {
  expect(hasMemoCache(createFiberWithUpdateQueue({ memoCache: { data: [], index: 0 } }))).toBe(
    true,
  );
});

it("should return false when there is no memo cache", () => {
  expect(hasMemoCache(createFiberWithUpdateQueue({}))).toBe(false);
  expect(hasMemoCache(createFiberWithUpdateQueue(null))).toBe(false);
});
