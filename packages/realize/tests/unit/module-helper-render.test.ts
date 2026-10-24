import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a render that calls a module helper", () => {
  const project = analyzeFixture("conformance-repros", "module-helper-render");
  const getFirstRenders = (name: string) =>
    getComponent(project, name).report.regions.map((region) => region.firstRenderState);

  it("decides the first render through an arrow helper", () => {
    expect(getFirstRenders("ModuleHelper")).not.toContain(null);
  });

  it("decides the first render through a function declaration", () => {
    expect(getFirstRenders("ModuleFunctionHelper")).not.toContain(null);
  });

  it("reaches every count a recursive helper's updaters can leave", () => {
    const { states } = getComponent(project, "RecurseAfterSet").report;
    expect(states.map((state) => state.conditions)).toContainEqual(["n === 2"]);
  });
});
