import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("repeated conditionals", () => {
  const project = analyzeFixture("conformance-repros", "repeated-fallbacks");

  it("reads the same || written twice as one value", () => {
    const { report } = getComponent(project, "Byline");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["author ? author : editor"],
      ["!(author ? author : editor)"],
    ]);
  });
});
