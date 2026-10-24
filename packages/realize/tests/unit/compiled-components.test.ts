import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a component the React Compiler already compiled", () => {
  const project = analyzeFixture("conformance-repros", "compiled-components");

  it("is analyzed, taking the memo cache's compute arm", () => {
    const { report } = getComponent(project, "CompiledToggle");
    expect(report.states.map((state) => state.conditions)).toEqual([["on"], ["!on"]]);
    expect(report.states.map((state) => state.transitions.map((t) => t.targets))).toEqual([
      [[1]],
      [[0]],
    ]);
  });

  it("renders a sentinel-cached element on the first render", () => {
    const { report } = getComponent(project, "CompiledLabel");
    expect(report.states).toHaveLength(1);
    expect(report.regions[0]?.firstRenderState).toBe(0);
  });
});
