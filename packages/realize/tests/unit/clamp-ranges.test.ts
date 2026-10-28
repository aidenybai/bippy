import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("values clamped with Math.min and Math.max", () => {
  const project = analyzeFixture("conformance-repros", "clamp-ranges");

  for (const name of ["ClampedStep", "ClampedFloor"]) {
    it(`${name} never passes its clamp`, () => {
      const { report } = getComponent(project, name);
      expect(report.states).toHaveLength(1);
      expect(report.unreachableBranches).toHaveLength(1);
    });
  }

  it("a clamped value in render keeps its bound", () => {
    const { report } = getComponent(project, "ClampedSpan");
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  it("a value clamped from a typed number can still be NaN, which fails its bound", () => {
    const { states } = getComponent(project, "ClampedQuantity").report;
    expect(states.map((state) => state.conditions)).toEqual([
      ["quantity >= 1"],
      ["!(quantity >= 1)"],
    ]);
  });

  it("a clamp over a state that can be NaN keeps it NaN, so the next step can stay below its bound", () => {
    const { states } = getComponent(project, "ClampedNext").report;
    expect(
      states.map((state) => state.transitions.map((transition) => transition.targets)),
    ).toEqual([
      [[0, 1], [0]],
      [
        [0, 1],
        [0, 1],
      ],
    ]);
  });
});
