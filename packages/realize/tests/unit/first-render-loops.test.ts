import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a render helper that loops over its argument", () => {
  const project = analyzeFixture("conformance-repros", "first-render-loops");

  const getFirstRenders = (name: string) =>
    getComponent(project, name).report.regions.flatMap(
      (region) => region.possibleFirstRenderStates,
    );

  it("runs on the first render's argument", () => {
    expect(getFirstRenders("LoopHelper")).toEqual([0]);
  });

  it("leaves the first render open when a render update changes the argument first", () => {
    expect(getFirstRenders("RenderUpdatedLoop")).toEqual([0, 1]);
  });
});
