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

  it("keeps the value a returning if arm stored", () => {
    expect(getTargets("CapturedReturnArm")).toEqual([[[1]], [[2]], [[0]]]);
  });

  it("keeps the value a returning switch case stored", () => {
    expect(getTargets("CapturedReturnCase")).toEqual([[[2]], [[0]], [[1]]]);
  });

  it("starts a try body from the values before its catch", () => {
    const { report } = getComponent(project, "CapturedTryCatch");
    const isCompleted = (conditions: string[]) => conditions.includes("!Unknown(throws)");
    const getState = (condition: string) =>
      report.states.findIndex(
        (state) => isCompleted(state.conditions) && state.conditions.includes(condition),
      );
    const zero = getState("step === 0");
    const one = getState("step === 1");
    const two = report.states.findIndex(
      (state, index) => isCompleted(state.conditions) && index !== zero && index !== one,
    );
    const targets = getTargets("CapturedTryCatch");
    expect(targets[zero]?.flat()).toContain(one);
    expect(targets[one]?.flat()).toContain(two);
  });
});
