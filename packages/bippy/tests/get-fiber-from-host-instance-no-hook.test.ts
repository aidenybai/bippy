// HACK: Avoid importing index so the missing-hook path remains observable.
import { expect, it } from "vite-plus/test";
import { getFiberFromHostInstance } from "../src/core.js";

it("should return null when no rdt hook is installed", () => {
  expect(getFiberFromHostInstance(document.createElement("div"))).toBe(null);
});
