import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a switch case block reached from several cases", () => {
  const project = analyzeFixture("conformance-repros", "shared-switch-cases");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("runs only for the cases that reach it", () => {
    expect(getTargets("GroupedBack")).toEqual([
      [[2], [1]],
      [[0], [1]],
      [[0], [1]],
    ]);
  });

  it("keeps a fall-through case's later update", () => {
    expect(getTargets("FallingCount")).toEqual([[[2]], [[2]], [[0]]]);
  });
});
