import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("the false side of an ordered comparison", () => {
  const project = analyzeFixture("conformance-repros", "nan-comparisons");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("keeps a NaN outcome for a parsed number", () => {
    expect(getConditions("AmountInput")).toEqual([
      ["Number(text) < 1"],
      ["!(Number(text) < 1)", "Number(text) >= 1"],
      ["!(Number(text) < 1)", "!(Number(text) >= 1)"],
    ]);
    expect(getConditions("ParsedInput")).toEqual([
      ["parseInt(text, 10) <= 0"],
      ["!(parseInt(text, 10) <= 0)", "parseInt(text, 10) > 0"],
      ["!(parseInt(text, 10) <= 0)", "!(parseInt(text, 10) > 0)"],
    ]);
  });

  it("is still the complement for a counted state and a length", () => {
    expect(getConditions("CountedSteps")).toEqual([["step < 1"], ["step >= 1"]]);
    expect(getConditions("ListedSteps")).toEqual([
      ["index < items.length - 1"],
      ["index >= items.length - 1"],
    ]);
  });
});
