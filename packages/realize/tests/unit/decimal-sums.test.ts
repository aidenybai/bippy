import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparing a sum that rounds", () => {
  const project = analyzeFixture("conformance-repros", "decimal-sums");

  it.each([
    ["SumEquals", ["value <= -0.9", "value + 0.2 === -0.7"]],
    ["SumAbove", ["value <= -1", "value + 0.8 > -0.2"]],
  ])("keeps the %s state the browser renders on mount", (name, conditions) => {
    const { states } = getComponent(project, name).report;
    expect(
      states.some((state) => conditions.every((condition) => state.conditions.includes(condition))),
    ).toBe(true);
  });
});
