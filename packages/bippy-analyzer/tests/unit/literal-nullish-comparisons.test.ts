import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("literal nullish comparisons", () => {
  const project = analyzeFixture("conformance-repros", "literal-nullish-comparisons");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("takes an object literal over a parameter default", () => {
    expect(getConditions("ExplicitFalse")).toEqual([[]]);
  });

  it("takes an array literal over a parameter default", () => {
    expect(getConditions("ArrayDefault")).toEqual([[]]);
  });

  it("takes a function over a parameter default", () => {
    expect(getConditions("CallbackDefault")).toEqual([[]]);
  });
});
