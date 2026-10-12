import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("compiler errors", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"));

  it.each([
    ["DynamicImport", /Handle Import expressions/],
    ["TryFinally", /TryStatement with a finalizer/],
  ])("keeps %s as a compiler-error bailout with the compiler's reason", (name, reason) => {
    const [bailout] = getComponent(project, name).analysis.bailouts;
    expect(bailout?.reason).toBe("compiler-error");
    expect(bailout?.message).toMatch(reason);
  });
});
