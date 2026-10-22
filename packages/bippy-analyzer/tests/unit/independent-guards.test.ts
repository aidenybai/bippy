import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("updates under guards in one handler", () => {
  const project = analyzeFixture("conformance-repros", "independent-guards");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("apply together when their ifs follow each other", () => {
    expect(getTargets("SequentialIfs")).toEqual([[[1, 2]], [[1, 2]], [[2]], [[2]]]);
  });

  it("stay apart on the two sides of one if", () => {
    expect(getTargets("IfElse")).toEqual([[[2]], [[0]], [[2]]]);
  });

  it("apply together when a later if reads a state an earlier guarded update set", () => {
    expect(getTargets("GuardThenReturn")[0]?.[0]).toContain(3);
    expect(getTargets("GuardedSetThenRead")[3]?.[0]).toContain(2);
  });

  it.fails("apply together after a guarded updater that reads another state", () => {
    expect(getTargets("GuardedUpdaterThenRead")[3]?.[0]).toContain(0);
  });
});
