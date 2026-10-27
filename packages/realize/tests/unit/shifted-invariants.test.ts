import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an increment from a state the reachable range bounds", () => {
  const project = analyzeFixture("conformance-repros", "shifted-invariants");

  it("never lands back below the range or on a value the state excludes", () => {
    const { report } = getComponent(project, "ClimbingCounter");
    expect(report.states.map((state) => state.transitions.flatMap((t) => t.targets))).toEqual([
      [1],
      [2],
      [2],
    ]);
  });

  it("keeps every target for a stale callback that reads an old count", () => {
    const { report } = getComponent(project, "StaleClimbingCounter");
    const [, , high] = report.states;
    expect(high?.transitions.flatMap((t) => t.targets)).toContain(1);
  });
});
