import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a length read from state that may not have one", () => {
  const project = analyzeFixture("conformance-repros", "non-number-lengths");

  it.each([
    ["ArrayOrNumber", ["!(value.length > 2)", "!(value.length <= 2)"]],
    ["AnyLength", ["!(value.length > 1)", "!(value.length < 2)"]],
    ["ObjectWithLength", ["!(value.length > 2)", "!(value.length <= 2)"]],
    ["ListSetNumber", ["!(value.length > 1)", "!(value.length <= 1)"]],
  ])("keeps the %s state where both comparisons fail", (name, conditions) => {
    const { states } = getComponent(project, name).report;
    expect(
      states.some((state) => conditions.every((condition) => state.conditions.includes(condition))),
    ).toBe(true);
  });
});
