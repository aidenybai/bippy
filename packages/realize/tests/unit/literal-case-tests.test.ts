import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a test over a binding with a known set of literal values", () => {
  const project = analyzeFixture("conformance-repros", "literal-case-tests");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("is decided when every value agrees", () => {
    expect(getConditions("EvenToggle")).toEqual([[]]);
  });

  it("narrows the binding to the values that pass", () => {
    expect(getConditions("OddPick")).toEqual([["x % 2 === 1"], ["x % 2 !== 1"]]);
  });
});
