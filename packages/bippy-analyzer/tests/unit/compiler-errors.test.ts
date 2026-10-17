import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("compiler errors", () => {
  const project = analyzeFixture("conformance-repros");

  it.each([["BreakOutOfTry", /finalizer .* and an early exit/]])(
    "keeps %s as a compiler-error bailout with the compiler's reason",
    (name, reason) => {
      const [bailout] = getComponent(project, name).analysis.bailouts;
      expect(bailout?.reason).toBe("compiler-error");
      expect(bailout?.message).toMatch(reason);
    },
  );

  it.each(["SaveButton", "DownloadButton", "UploadButton", "RetryButton"])(
    "lowers the finally clause of %s before each way out of its try and catch blocks",
    (name) => {
      expect(getComponent(project, name).analysis.bailouts).toEqual([]);
    },
  );

  it("lowers a dynamic import as a value it can't see into", () => {
    expect(getComponent(project, "DynamicImport").analysis.bailouts).toEqual([]);
  });
});
