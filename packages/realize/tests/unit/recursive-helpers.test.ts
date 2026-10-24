import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("recursive helpers", () => {
  const project = analyzeFixture("conformance-repros", "recursive-helpers");

  it("reads a recursive merge's call to itself as a value it can't see into", () => {
    const { analysis, report } = getComponent(project, "MergedSettings");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states).toHaveLength(2);
  });

  it("inlines a recursive render helper once, without bailing out on its own call", () => {
    expect(getComponent(project, "Outline").analysis.bailouts).toEqual([]);
  });
});
