import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("template literals", () => {
  const project = analyzeFixture("conformance-repros", "template-literals");

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions,
      state.transitions.map((transition) => transition.targets),
    ]);

  it("narrows the value a template reads when the template is compared", () => {
    expect(getStates("TemplateCompare")).toEqual([
      [['mode + "-panel" === "a-panel"'], [[1]]],
      [['mode + "-panel" !== "a-panel"'], [[1]]],
    ]);
  });

  it("knows a template over a number is never empty", () => {
    expect(getStates("TemplateCount")).toEqual([[[], []]]);
  });

  it("folds a template with no parts", () => {
    expect(getStates("TemplateStatic")).toEqual([[[], []]]);
  });
});
