import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { getFixtureConfig } from "./helpers.js";

describe("component names", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "wrapped-components");

  it("names components wrapped in forwardRef and memo after their variable", () => {
    expect(project.components.map((component) => component.analysis.name).sort()).toEqual([
      "Badge",
      "Button",
      "Pill",
    ]);
  });
});
