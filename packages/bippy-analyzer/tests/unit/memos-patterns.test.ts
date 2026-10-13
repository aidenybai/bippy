import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

describe("memos patterns", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "memos-patterns");

  it("keeps a tag it can't name dynamic instead of calling it a component", () => {
    const { render } = getComponent(project, "Heading").analysis;
    expect(render.kind === "JsxExpression" && render.tag.kind).toBe("DynamicTag");
  });

  it("ties a call's result to the places its callback captures", () => {
    const list = getComponent(project, "LocaleList");
    const query = getBinding(list, "query");
    const matches = getBinding(list, "LOCALES.filter(function)");
    expect(matches.inputPlaces).toContainEqual({ bindingId: query.id, path: [] });
  });

  it("doesn't call a branch unreachable when another branch's test takes it", () => {
    expect(getComponent(project, "OptionIcon").report.unreachableBranches).toEqual([]);
  });
});
