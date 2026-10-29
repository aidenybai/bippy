import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an array method on literal initial state whose callback reads other state", () => {
  const project = analyzeFixture("conformance-repros", "first-render-callbacks");

  it.each(["SelectedSome", "FilteredCount", "SelectedIndex"])("%s has one first render", (name) => {
    const { report } = getComponent(project, name);
    expect(report.regions.flatMap((region) => region.possibleFirstRenderStates)).toEqual([0]);
  });
});
