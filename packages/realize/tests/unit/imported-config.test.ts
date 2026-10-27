import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an imported object constant", () => {
  const project = analyzeFixture("conformance-repros", "imported-config");

  it.each([
    ["ConfigInitial", "count === 3"],
    ["ConfigLength", "count === 2"],
  ])("decides the first render of %s from the declared fields", (name, condition) => {
    const { report } = getComponent(project, name);
    const firstRender = report.regions[0]?.firstRenderState;
    expect(firstRender).not.toBeNull();
    expect(report.states[firstRender ?? -1]?.conditions).toContain(condition);
  });

  it("folds a branch on a declared field", () => {
    const { report } = getComponent(project, "ConfigMode");
    expect(report.states.map((state) => state.conditions).sort()).toEqual([
      ["!isOpen"],
      ["isOpen"],
    ]);
  });

  it("keeps an object another file writes open", () => {
    const { report } = getComponent(project, "SharedInitial");
    expect(report.regions[0]?.firstRenderState).toBeNull();
  });

  it("keeps an object this file writes live", () => {
    const { report } = getComponent(project, "LocalWrite");
    expect(report.states.length).toBeGreaterThan(2);
  });
});
