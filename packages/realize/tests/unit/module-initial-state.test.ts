import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state whose initial value is a module object constant", () => {
  const project = analyzeFixture("conformance-repros", "module-initial-state");
  const getFirstRenders = (name: string) =>
    getComponent(project, name).report.regions.map((region) => region.firstRenderState);

  it("has a first render when a reducer starts from it", () => {
    expect(getFirstRenders("ReducerFromModuleObject")).not.toContain(null);
  });

  it("has a first render when a lazy initializer returns it", () => {
    expect(getFirstRenders("StateFromModuleObject")).not.toContain(null);
  });
});
