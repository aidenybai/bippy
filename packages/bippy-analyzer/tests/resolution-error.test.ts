import { expect, it } from "vite-plus/test";
import { getResolutionError } from "../src/resolution-error.js";

it("retains nested toolchain causes instead of only the outer wrapper message", () => {
  expect(
    getResolutionError(
      new Error("resolve failed", {
        cause: new Error("plugin failed", { cause: new Error("missing config") }),
      }),
    ),
  ).toBe("resolve failed: plugin failed: missing config");
});

it("terminates when an error cause refers back to the same error", () => {
  const error = new Error("cyclic cause");
  error.cause = error;
  expect(getResolutionError(error)).toBe("cyclic cause");
});

it("retains thrown values that are not Error instances", () => {
  expect(getResolutionError("plugin failure")).toBe("plugin failure");
  expect(getResolutionError(undefined)).toBe("undefined");
  expect(getResolutionError(new Error("plugin", { cause: "failure" }))).toBe("plugin: failure");
});
