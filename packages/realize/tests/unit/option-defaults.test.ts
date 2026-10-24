import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparing an object with a primitive", () => {
  const project = analyzeFixture("symbolic-tree", "option-defaults.tsx");

  it("folds a defaulted option, so an invariant behind it is never walked", () => {
    const { report } = getComponent(project, "Greeting");
    expect(report.claimOutcomes).toEqual([]);
    expect(report.states).toHaveLength(2);
  });

  it("decides strict comparisons and loose ones against null", () => {
    const { analysis, report } = getComponent(project, "ListSummary");
    expect(report.states).toHaveLength(1);
    expect(analysis.render).toMatchObject({
      kind: "JsxExpression",
      children: [{ kind: "Primitive", value: "some" }],
    });
  });
});
