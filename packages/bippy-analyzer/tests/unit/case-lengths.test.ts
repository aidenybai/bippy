import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparisons on the cases of a field and of a string length", () => {
  const project = analyzeFixture("conformance-repros", "case-lengths");

  it("a number field that only ever holds zero is never positive", () => {
    const { report } = getComponent(project, "OneField");
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  it("a string state's length follows its literal cases", () => {
    const { report } = getComponent(project, "StrTwo");
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });
});
