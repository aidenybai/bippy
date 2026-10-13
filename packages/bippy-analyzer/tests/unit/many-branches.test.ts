import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent, getFixtureConfig } from "./helpers";

describe("a render with more combinations than are listed", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "many-branches");
  const toolbar = getComponent(project, "Toolbar");

  it("stops listing at the cap and says so", () => {
    expect(toolbar.report.isTruncated).toBe(true);
    expect(toolbar.report.states.length).toBeLessThanOrEqual(256 * 14);
  });

  it("claims no branch never renders, as it didn't try every combination", () => {
    expect(toolbar.report.unreachableBranches).toEqual([]);
  });
});
