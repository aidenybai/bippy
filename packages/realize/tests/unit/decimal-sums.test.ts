import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparing a sum that rounds", () => {
  const project = analyzeFixture("conformance-repros", "decimal-sums");

  it.each([
    ["SumEquals", "value <= -0.9", "value + 0.2 !== -0.7"],
    ["SumAbove", "value <= -1", "value + 0.8 <= -0.2"],
  ])("keeps the %s state the browser renders on mount", (name, start, hidden) => {
    const { report } = getComponent(project, name);
    const firstRender = report.regions.flatMap((region) =>
      region.possibleFirstRenderStates.map((index) => report.states[index].conditions),
    );
    expect(firstRender.length).toBeGreaterThan(0);
    expect(firstRender.every((conditions) => conditions.includes(start))).toBe(true);
    expect(firstRender.some((conditions) => conditions.includes(hidden))).toBe(false);
  });
});
