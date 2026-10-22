import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("loose equality against a literal of another type", () => {
  const project = analyzeFixture("conformance-repros", "loose-equality");

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions,
      state.transitions.flatMap((transition) => transition.targets),
    ]);

  it("decides true == 1 as JavaScript does", () => {
    const { report } = getComponent(project, "TrueEqOne");
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never value != 1",
    ]);
  });

  it("decides a string case against a number", () => {
    expect(getStates("StringEqNumber")).toEqual([
      [["value == 1"], [1]],
      [["value != 1"], [1]],
    ]);
  });

  it("decides boolean cases against a number", () => {
    expect(getStates("FalseNeOne")).toEqual([
      [["value != 1"], [1]],
      [["value == 1"], [1]],
    ]);
    expect(getStates("BooleanEqOne")).toEqual([
      [["value == 1"], [1]],
      [["value != 1"], [0]],
    ]);
  });
});
