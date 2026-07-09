// intentionally avoids importing ../index.js so no rdt hook is installed
import { expect, it } from "vitest";
import { getFiberFromHostInstance } from "../core.js";

it("should return null when no rdt hook is installed", () => {
  expect(getFiberFromHostInstance(document.createElement("div"))).toBe(null);
});
