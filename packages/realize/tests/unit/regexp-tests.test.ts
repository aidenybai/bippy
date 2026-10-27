import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a regular expression literal", () => {
  const project = analyzeFixture("conformance-repros", "regexp-tests");

  const getFirstRenderConditions = (name: string) => {
    const { report } = getComponent(project, name);
    return (report.regions[0]?.possibleFirstRenderStates ?? []).map(
      (index) => report.states[index]?.conditions,
    );
  };

  it.each([
    ["EmailHint", ["!EMAIL.test(email)"]],
    ["ImportedDigits", ["DIGITS.test(code)"]],
  ])("decides the first render of %s from the initial text", (name, conditions) => {
    expect(getFirstRenderConditions(name)).toEqual([conditions]);
  });

  it("folds a test on a literal string", () => {
    const { report } = getComponent(project, "LiteralPattern");
    expect(report.states.map((state) => state.conditions).sort()).toEqual([
      ["!isOpen"],
      ["isOpen"],
    ]);
  });

  it("leaves a test with the global flag open, since it depends on lastIndex", () => {
    expect(getFirstRenderConditions("GlobalPattern")).toHaveLength(2);
  });
});
