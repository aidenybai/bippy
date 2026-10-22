import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("unknown tests", () => {
  const project = analyzeFixture("conformance-repros", "unknown-tests");

  it("doesn't decide one unknown test by another that prints alike", () => {
    const status = getComponent(project, "QueryStatus");
    expect(status.report.unreachableBranches).toEqual([]);
    expect(status.report.states).toHaveLength(3);
  });

  it("decides a second test of one unknown by the first", () => {
    const trimmed = getComponent(project, "TrimmedInput");
    expect(trimmed.report.states.map((state) => state.conditions)).toEqual([
      ["(input as string).trim().length > 0"],
      ["(input as string).trim().length <= 0"],
    ]);
  });

  it("decides a second test of a value with an unknown part by the first", () => {
    const fallback = getComponent(project, "FallbackLength");
    expect(fallback.report.states).toHaveLength(2);
  });
});
