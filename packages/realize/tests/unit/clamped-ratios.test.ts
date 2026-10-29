import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state clamped between two numbers", () => {
  const project = analyzeFixture("conformance-repros", "clamped-ratios");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("can hold a fraction when its input is unknown", () => {
    expect(getConditions("PointerRatio")).toContainEqual(["ratio !== 0", "ratio !== 1"]);
  });

  it("stays on whole steps when its input is whole", () => {
    expect(getConditions("SteppedRatio")).toHaveLength(3);
  });
});
