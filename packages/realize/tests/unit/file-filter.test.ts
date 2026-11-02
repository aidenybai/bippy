import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/project/analyze-project";
import { getFixtureConfig } from "./helpers";

describe("a file filter", () => {
  it("only models the components in the selected files", async () => {
    const project = await analyzeProject(getFixtureConfig("conformance-repros"), "self-updates");
    expect(project.components.length).toBeGreaterThan(0);
    for (const component of project.components)
      expect(component.analysis.file).toContain("self-updates");
  });
});
