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
});
