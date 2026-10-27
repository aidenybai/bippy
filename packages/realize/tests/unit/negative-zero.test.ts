import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state that can hold both 0 and -0", () => {
  const project = analyzeFixture("conformance-repros", "negative-zero");

  it("keeps 0 and -0 apart, so both signs of 1 / n are reachable", () => {
    const { states } = getComponent(project, "NegatedZero").report;
    expect(states.map((state) => state.conditions)).toEqual([["1 / n > 0"], ["!(1 / n > 0)"]]);
  });
});
