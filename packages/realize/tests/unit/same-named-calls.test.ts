import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("calls that print the same", () => {
  const project = analyzeFixture("conformance-repros", "same-named-calls");

  it("stay apart, so knowing one result says nothing about the other", () => {
    const range = getComponent(project, "DateRangeLabel");
    expect(range.report.states.map((state) => state.conditions.at(-1))).toEqual([
      "parseDate(Unknown(member)) && parseDate(Unknown(member))",
      "!(parseDate(Unknown(member)) && parseDate(Unknown(member)))",
      "!(parseDate(Unknown(member)) || parseDate(Unknown(member)))",
    ]);
    expect(range.report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never !parseDate(Unknown(member)) && !parseDate(Unknown(member))",
    ]);
  });
});
