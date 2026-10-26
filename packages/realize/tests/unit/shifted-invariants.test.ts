import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an increment from a state the reachable range bounds", () => {
  const project = analyzeFixture("conformance-repros", "shifted-invariants");

  it("never lands back below the range", () => {
    const { report } = getComponent(project, "ClimbingCounter");
    expect(report.states.map((state) => state.transitions.flatMap((t) => t.targets))).toEqual([
      [1],
      [2],
      [1, 2],
    ]);
  });
});
