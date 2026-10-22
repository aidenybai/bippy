import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler returned by a call that received callbacks", () => {
  const project = analyzeFixture("conformance-repros", "wrapped-call-results");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("is collected when it is a field of the call result", () => {
    expect(getTargets("SubmitField")).toEqual([
      [[0, 1], [0]],
      [[1], [0]],
    ]);
  });

  it("may or may not run the callbacks it received", () => {
    expect(getTargets("KeyField")).toEqual([
      [[0], [0, 1]],
      [[0], [1]],
    ]);
  });
});
