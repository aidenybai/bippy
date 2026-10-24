import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("guarded transitions", () => {
  const project = analyzeFixture("conformance-repros", "guarded-transitions");

  const getTargets = (name: string, handlerId: string) =>
    getComponent(project, name).report.states.map(
      (state) =>
        state.transitions.find((transition) => transition.handlerId === handlerId)?.targets,
    );

  it("applies a guarded update only from states where its guard can hold", () => {
    expect(getTargets("GuardIgnored", "t2")).toEqual([[1], [1], [2]]);
  });

  it("changes nothing when no guard can hold", () => {
    expect(getTargets("NeverTrueGuard", "t1")).toEqual([[0]]);
  });

  it("respects an early return", () => {
    expect(getTargets("EarlyReturnGuard", "t2")).toEqual([[0], [1], [1]]);
  });
});
