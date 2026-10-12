import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("unknown tests", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "unknown-tests");

  it("doesn't decide one unknown test by another that prints alike", () => {
    const status = getComponent(project, "QueryStatus");
    expect(status.report.unreachableBranches).toEqual([]);
    expect(status.report.states).toHaveLength(3);
  });
});
