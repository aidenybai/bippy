import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a library the compiler won't memoize", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "watched-form.tsx"),
    "PlanForm",
  );

  it("is still analyzed, since the analysis doesn't memoize", () => {
    expect(analysis.bailouts).toEqual([]);
    expect(report.states).toHaveLength(2);
  });
});
