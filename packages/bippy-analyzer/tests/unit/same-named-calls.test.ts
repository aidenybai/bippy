import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("calls that print the same", () => {
  const project = analyzeFixture("conformance-repros", "same-named-calls");

  it("stay apart, so knowing one result says nothing about the other", () => {
    const range = getComponent(project, "DateRangeLabel");
    expect(range.report.unreachableBranches).toEqual([]);
  });
});
