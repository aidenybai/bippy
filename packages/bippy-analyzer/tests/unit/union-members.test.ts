import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent, getFixtureConfig } from "./helpers";

describe("union members", () => {
  const project = analyzeProject(getFixtureConfig("symbolic-tree"), "query");

  it("varies a query's fields together, so no state is both pending and failed", () => {
    const { report } = getComponent(project, "ProfileStatus");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["useQuery().isPending"],
      ["!useQuery().isPending", "useQuery().isError", "useQuery().data"],
      ["!useQuery().isPending", "useQuery().isError", "!useQuery().data"],
      ["!useQuery().isPending", "!useQuery().isError"],
    ]);
  });
});
