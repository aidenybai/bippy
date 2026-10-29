import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparisons that coerce state that may not be a number", () => {
  const project = analyzeFixture("conformance-repros", "loose-comparisons");

  it.each([
    ["BooleanBetween", ["value >= 1", "value <= 1", "value !== 1"]],
    ["NullBetween", ["value >= 0", "value <= 0", "value != 0"]],
    ["TextPlusOneAbove", ["value < 3", "value + 1 > 5"]],
    ["LooseThenSum", ["value == 1", "value + 1 !== 2"]],
  ])("keeps the %s state where they disagree", (name, conditions) => {
    const { states } = getComponent(project, name).report;
    expect(
      states.some((state) => conditions.every((condition) => state.conditions.includes(condition))),
    ).toBe(true);
  });
});
