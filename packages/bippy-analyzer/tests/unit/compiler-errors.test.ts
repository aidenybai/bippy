import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("compiler errors", () => {
  const project = analyzeFixture("conformance-repros");

  it.each([
    ["DynamicImport", /Handle Import expressions/],
    ["TryFinally", /ThrowStatement inside of try\/catch/],
  ])("keeps %s as a compiler-error bailout with the compiler's reason", (name, reason) => {
    const [bailout] = getComponent(project, name).analysis.bailouts;
    expect(bailout?.reason).toBe("compiler-error");
    expect(bailout?.message).toMatch(reason);
  });

  it.each(["SaveButton", "DownloadButton"])(
    "lowers the finally clause of %s, whose try and catch blocks run to their end",
    (name) => {
      expect(getComponent(project, name).analysis.bailouts).toEqual([]);
    },
  );
});
