import { expect, it } from "vite-plus/test";
import {
  BippyError,
  BippyHookInspectionError,
  BippyHookRenderError,
  BippySourceMapError,
  BippyUnsupportedHookError,
} from "../../../bippy/src/errors.js";

it("creates stable named Bippy errors", () => {
  const cause = new Error("original failure");
  const hookRenderError = new BippyHookRenderError("render failure", cause);

  expect(hookRenderError).toBeInstanceOf(BippyError);
  expect(hookRenderError.name).toBe("BippyHookRenderError");
  expect(hookRenderError.cause).toBe(cause);
  expect(new BippyHookInspectionError("inspection failure").name).toBe("BippyHookInspectionError");
  expect(new BippyUnsupportedHookError("unsupported hook").name).toBe("BippyUnsupportedHookError");
  expect(new BippySourceMapError("source-map failure").name).toBe("BippySourceMapError");
});
