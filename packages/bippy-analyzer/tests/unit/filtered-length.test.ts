import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

describe("filtered length", () => {
  const project = analyzeProject(getFixtureConfig("symbolic-tree"), "search");
  const component = getComponent(project, "SearchList");

  it("never finds matches in an empty list", () => {
    expect(component.report.states.map((state) => state.conditions)).toEqual([
      ["items.length === 0"],
      ["items.length !== 0", "items.filter(function).length > 0"],
      ["items.length !== 0", "items.filter(function).length <= 0"],
    ]);
  });

  it("makes a filtered list depend on the list it filters", () => {
    const items = getBinding(component, "items");
    expect(getBinding(component, "items.filter(function)").inputPlaces).toContainEqual({
      bindingId: items.id,
      path: [],
    });
  });
});
