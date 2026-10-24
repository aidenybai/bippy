import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a reducer's dispatch handed to a child", () => {
  const project = analyzeFixture("conformance-repros", "passed-dispatch");

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => [
      state.conditions,
      state.transitions.map((transition) => transition.targets),
    ]);

  it.each(["DispatchProp", "DispatchContext"])("%s runs the reducer from the child", (name) => {
    expect(getStates(name)).toEqual([
      [["isOn"], [[0]]],
      [["!isOn"], [[0, 1]]],
    ]);
  });
});
