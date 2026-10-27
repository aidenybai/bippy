import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a project helper called with only literal arguments", () => {
  const project = analyzeFixture("conformance-repros", "literal-helper-calls");

  it.each(["LiteralDouble", "LiteralLoop"])("folds the result in %s", (name) => {
    const { report } = getComponent(project, name);
    expect(report.states.map((state) => state.conditions)).toEqual([["isOpen"], ["!isOpen"]]);
  });

  it("decides a state initial computed by a helper", () => {
    const { report } = getComponent(project, "LiteralInitial");
    expect(report.regions[0]?.firstRenderState).toBe(0);
    expect(report.states[0]?.conditions).toEqual(["count === 2"]);
  });

  it.each([
    ["ModuleLetGetter", "getClicks() !== 0"],
    ["ModuleArrayGetter", "getLogSize() !== 0"],
    ["ImportedGetter", 'getRole() !== "guest"'],
  ])("keeps the module read in %s live after a handler changes it", (name, changed) => {
    const { report } = getComponent(project, name);
    const target = report.states.findIndex((state) => state.conditions.includes(changed));
    expect(report.regions[0]?.firstRenderState).toBe(0);
    expect(report.states[0]?.transitions.flatMap((transition) => transition.targets)).toContain(
      target,
    );
  });

  it("leaves a helper that writes module state in render undecided", () => {
    const { report } = getComponent(project, "RenderCounter");
    expect(report.regions[0]?.firstRenderState).toBeNull();
  });
});
