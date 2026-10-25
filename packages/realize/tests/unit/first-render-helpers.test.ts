import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a module helper called in render", () => {
  const project = analyzeFixture("conformance-repros", "first-render-helpers");

  it.each(["CycledHelper", "ClampedHelper", "DoubledHelper"])("%s has one first render", (name) => {
    const { report } = getComponent(project, name);
    expect(report.regions.flatMap((region) => region.possibleFirstRenderStates)).toEqual([0]);
  });
});
