import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter given the render's value after an earlier update", () => {
  const project = analyzeFixture("conformance-repros", "restored-updates");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("restores the value the state had when the handler ran", () => {
    expect(getTargets("RestoredAfterUpdate")).toEqual([
      [[0], [0]],
      [[1], [0]],
    ]);
  });

  it("restores a field copied from the render's object", () => {
    expect(getTargets("RestoredFieldAfterUpdate")).toEqual([
      [[0], [0]],
      [[1], [0]],
    ]);
  });
});
