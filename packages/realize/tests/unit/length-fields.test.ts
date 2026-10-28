import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an object field named length", () => {
  const project = analyzeFixture("conformance-repros", "length-fields");

  it.each([
    ["LengthFieldDown", "value.length < 0"],
    ["SpanBelowZero", "span.length < 0"],
  ])("lets %s go below zero", (name, condition) => {
    const { states } = getComponent(project, name).report;
    expect(states.some((state) => state.conditions.includes(condition))).toBe(true);
  });

  it("keeps an array length non-negative", () => {
    const { states } = getComponent(project, "ListNeverNegative").report;
    expect(states.every((state) => !state.conditions.includes("items.length < 0"))).toBe(true);
  });
});
