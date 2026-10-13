import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent, getFixtureConfig } from "./helpers";

describe("guarded ternary", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "guarded-ternary");

  it("claims no side of a ternary unreachable when it renders only behind another test", () => {
    expect(getComponent(project, "DateRangeLabel").report.unreachableBranches).toEqual([]);
  });
});
