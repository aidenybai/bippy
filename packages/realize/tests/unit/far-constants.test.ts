import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("bounds next to a constant beyond 2^53", () => {
  const project = analyzeFixture("conformance-repros", "far-constants");

  it.each(["FarAbove", "FarBelow"])("keeps the small state of %s", (name) => {
    const { states } = getComponent(project, name).report;
    expect(states.some((state) => state.conditions.includes("value < 1"))).toBe(true);
  });
});
