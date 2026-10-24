import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an update that keeps its own place", () => {
  const project = analyzeFixture("conformance-repros", "self-place-updates");

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions,
      state.transitions.flatMap((transition) => transition.targets),
    ]);

  for (const name of ["OrDefault", "OrAssign"]) {
    it(`${name} only reaches the fallback from the empty string`, () => {
      expect(getStates(name)).toEqual([
        [['text === "b"'], [0]],
        [['text !== "b"'], [0]],
      ]);
    });
  }

  it("keeps a field copied from the state itself", () => {
    expect(getStates("SelfField")).toEqual([
      [['box.mode === "b"'], [0]],
      [['box.mode !== "b"'], [0]],
      [[], [2]],
    ]);
  });
});
