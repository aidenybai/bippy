import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a captured let reassigned under an if", () => {
  const project = analyzeFixture("conformance-repros", "captured-let-branches");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("keeps the value from before the if on the paths that skip it", () => {
    const { report } = getComponent(project, "CapturedStepLabel");
    expect(report.regions[0]?.firstRenderState).toBe(0);
    expect(getTargets("CapturedStepLabel")).toEqual([[[1]], [[2]], [[2]]]);
  });

  it("gives a handler the value for the render it came from", () => {
    expect(getTargets("CapturedNextStep")).toEqual([[[1]], [[2]], [[1]]]);
  });

  it("keeps each switch case's own value", () => {
    const { report } = getComponent(project, "CapturedSwitchLabel");
    const firstState = report.regions[0]?.firstRenderState ?? 0;
    expect(report.states[firstState]?.conditions.join()).toContain('!== "single"');
  });
});
