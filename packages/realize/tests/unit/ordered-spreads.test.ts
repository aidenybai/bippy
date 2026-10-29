import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("ordered spreads", () => {
  const project = analyzeFixture("conformance-repros", "ordered-spreads");

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions,
      state.transitions.map((transition) => transition.targets),
    ]);

  const checkStates = [
    [['state.status === "idle"'], [[1]]],
    [['state.status !== "idle"'], [[1]]],
  ];

  it("lets a spread override the properties written before it", () => {
    expect(getStates("DefaultsThenSpread")).toEqual(checkStates);
  });

  it("reads a field only the spread provides", () => {
    expect(getStates("SpreadOnly")).toEqual(checkStates);
  });

  it("keeps a property the spread's type can't override", () => {
    expect(getStates("SpreadThenDefault")).toEqual(checkStates);
  });

  it("treats a spread of an unknown value as overriding what came before it", () => {
    expect(getStates("UnknownSpread")).toEqual([
      ...checkStates,
      [['Unknown(spread) === "idle"'], [[2, 3]]],
      [['Unknown(spread) !== "idle"'], [[2, 3]]],
    ]);
  });
});
