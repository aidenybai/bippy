import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparing a conditional value", () => {
  const project = analyzeFixture("symbolic-tree", "conditional-comparisons.tsx");

  it("compares each branch under its test, so a fallback equals itself only when it's taken", () => {
    const { report } = getComponent(project, "TitleButton");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['(title != null ? title : "Untitled") === "Untitled"'],
      ['(title != null ? title : "Untitled") !== "Untitled"'],
    ]);
    expect(report.states[0]?.transitions.map((edge) => edge.targets)).toEqual([[1]]);
  });

  it("decides a bound on the branch whose value is a constant", () => {
    const { report } = getComponent(project, "ColumnLayout");
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      expect.stringContaining("!isWide"),
    ]);
  });
});
