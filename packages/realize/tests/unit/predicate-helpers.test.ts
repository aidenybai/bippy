import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a pure project helper called with state", () => {
  const project = analyzeFixture("conformance-repros", "predicate-helpers");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions.join(" & "),
      state.transitions.flatMap((transition) => transition.targets).sort(),
    ]);

  it("relates its result to the state it reads, so a step never goes back", () => {
    expect(getTargets("PredicateSteps")).toEqual([
      ["step >= 3", [0]],
      ["step < 3", [0, 1]],
    ]);
  });

  it("decides each toggle from the state it reads", () => {
    expect(getTargets("LabelToggle")).toEqual([
      ['(isOn ? "on" : "off") === "on"', [1]],
      ['(isOn ? "on" : "off") !== "on"', [0]],
    ]);
  });
});
