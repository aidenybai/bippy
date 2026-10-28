import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("text that loosely equals zero", () => {
  const project = analyzeFixture("conformance-repros", "truthy-zero-text");

  it.each([
    ["SpaceOrOne", ["value == 0", "(value || 1) !== 1"]],
    ["SpaceNotNot", ["value == 0", "!!value === true"]],
  ])("keeps the %s state where it is still truthy", (name, conditions) => {
    const { states } = getComponent(project, name).report;
    expect(
      states.some((state) => conditions.every((condition) => state.conditions.includes(condition))),
    ).toBe(true);
  });
});
