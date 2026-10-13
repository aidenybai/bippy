import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent, getFixtureConfig } from "./helpers";

describe("calls that print the same", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "same-named-calls");

  it("stay apart, so knowing one result says nothing about the other", () => {
    const range = getComponent(project, "DateRangeLabel");
    expect(range.report.unreachableBranches).toEqual([]);
  });
});
