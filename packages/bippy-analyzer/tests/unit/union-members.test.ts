import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

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

  it("gives a field every member's values, though TypeScript narrowed where it's read", () => {
    const project = analyzeProject(getFixtureConfig("symbolic-tree"), "share-dialog");
    const component = getComponent(project, "ShareButton");
    const { report, analysis } = component;
    const dialog = getBinding(component, "dialog");
    expect(analysis.placeDomains.get({ bindingId: dialog.id, path: ["type"] })).toMatchObject({
      cases: expect.arrayContaining([{ kind: "Literal", value: undefined }]),
    });
    expect(report.unreachableBranches).toEqual([]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["!dialog.isOpen"],
      ["dialog.isOpen"],
    ]);
  });
});
