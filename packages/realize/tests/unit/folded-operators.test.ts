import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("unary and bitwise operators on known numbers", () => {
  const project = analyzeFixture("conformance-repros", "folded-operators");

  it("fold, so no state renders the impossible arm", () => {
    const { states } = getComponent(project, "FoldedOperators").report;
    expect(states.map((state) => state.conditions)).toEqual([[]]);
  });
});
