import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

describe("Suspense", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "suspense-fallback");

  it("predicts the fallback and the children as separate states", () => {
    const panel = getComponent(project, "LazyPanel");
    expect(getBinding(panel, "suspended").kind).toBe("suspense");
    expect(panel.report.states.map((state) => state.conditions)).toEqual([
      ["suspended"],
      ["!suspended"],
    ]);
  });

  it("recognizes Suspense imported under another name", () => {
    const panel = getComponent(project, "AliasedLazyPanel");
    expect(getBinding(panel, "suspended").kind).toBe("suspense");
  });
});
