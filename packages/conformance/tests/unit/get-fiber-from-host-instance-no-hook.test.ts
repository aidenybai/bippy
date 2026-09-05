// intentionally avoids importing ../index.js so no rdt hook is installed
import { expect, it } from "vite-plus/test";
import { getFiberFromHostInstance } from "../../../bippy/src/core.js";

it("should return null when no rdt hook is installed", () => {
  expect(getFiberFromHostInstance(document.createElement("div"))).toBe(null);
});
