import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("self updates", () => {
  const project = analyzeFixture("conformance-repros", "self-updates");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("keeps the source state when a setter receives the state itself", () => {
    expect(getTargets("SelfToggle")).toEqual([[[0]]]);
  });

  it("keeps the source state on the arm that passes the state through", () => {
    expect(getTargets("SelfPhase")).toEqual([[[1]], [[1]], [[2]]]);
  });
});
