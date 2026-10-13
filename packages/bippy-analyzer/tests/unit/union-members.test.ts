import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent, getFixtureConfig } from "./helpers";

describe("union members", () => {
  it("varies a query's fields together, so no state is both pending and failed", () => {
    const project = analyzeProject(getFixtureConfig("symbolic-tree"), "query");
    const { report } = getComponent(project, "ProfileStatus");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["useQuery().isPending"],
      ["!useQuery().isPending", "useQuery().isError", "useQuery().data"],
      ["!useQuery().isPending", "useQuery().isError", "!useQuery().data"],
      ["!useQuery().isPending", "!useQuery().isError"],
    ]);
  });

  it("ignores a field read only where TypeScript already narrowed the union", () => {
    const project = analyzeProject(getFixtureConfig("symbolic-tree"), "share-dialog");
    const { report } = getComponent(project, "ShareButton");
    expect(report.unreachableBranches).toEqual([]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["!dialog.isOpen"],
      ["dialog.isOpen"],
    ]);
  });
});
