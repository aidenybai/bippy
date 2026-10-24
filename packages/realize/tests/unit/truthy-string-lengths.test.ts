import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("the length of a string known to be truthy or falsy", () => {
  const project = analyzeFixture("conformance-repros", "truthy-string-lengths");

  it("a truthy string is never empty", () => {
    const { report } = getComponent(project, "NestedLength");
    expect(report.states.map((state) => state.conditions)).toEqual([["label"], ["!label"]]);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  it("a falsy optional string may be missing rather than empty", () => {
    const { report } = getComponent(project, "OptionalLength");
    expect(report.states).toHaveLength(3);
    expect(report.unreachableBranches).toHaveLength(0);
  });
});
