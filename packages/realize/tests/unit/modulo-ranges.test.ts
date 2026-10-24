import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state updated by a remainder", () => {
  const project = analyzeFixture("conformance-repros", "modulo-ranges");

  it.each(["CycleThree", "CycleThreeUpdater"])("%s stays below the divisor", (name) => {
    const conditions = getComponent(project, name).report.states.flatMap(
      (state) => state.conditions,
    );
    expect(conditions).not.toContain("step >= 3");
    expect(conditions).toEqual(["step === 2", "step !== 2"]);
  });
});
