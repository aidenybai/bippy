import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("find over a literal array", () => {
  const project = analyzeFixture("conformance-repros", "find-literal-actions");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("returns the first element whose predicate is decided true", () => {
    expect(getTargets("FindRun")).toEqual([
      [[1], [2]],
      [[1], [2]],
      [[1], [2]],
    ]);
  });

  it("returns undefined when no predicate is true", () => {
    const { analysis, report } = getComponent(project, "FindNone");
    expect(analysis.handlers).toEqual([]);
    expect(report.states).toHaveLength(1);
  });

  it("also resolves a find made during render", () => {
    expect(getTargets("FindInRender")).toEqual([[[0]], [[0]]]);
  });
});
