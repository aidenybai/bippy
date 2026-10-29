import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparing an integer sum that rounds", () => {
  const project = analyzeFixture("conformance-repros", "near-integers");

  it.each([
    ["PlusOne", ["value > 3", "value + 1 <= 4"]],
    ["FromEight", ["value > 3", "8 - value >= 5"]],
    ["DifferenceAtOne", ["y > 0", "x - y >= 1"]],
  ])("keeps the %s state a nudged value renders", (name, conditions) => {
    const { states } = getComponent(project, name).report;
    expect(
      states.some((state) => conditions.every((condition) => state.conditions.includes(condition))),
    ).toBe(true);
  });
});
