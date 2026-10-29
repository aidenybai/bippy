import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a store to an object literal setter accessor", () => {
  const project = analyzeFixture("conformance-repros", "setter-accessors");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state, index) =>
      state.transitions.flatMap((transition) =>
        transition.targets
          .filter((target) => target !== index)
          .map((target) => [
            state.conditions.join(" && "),
            states[target]?.conditions.join(" && "),
          ]),
      ),
    );
  };

  it("runs the setter with the stored value", () => {
    expect(getEdges("SetterSink")).toEqual([
      ["isOn", "!isOn"],
      ["!isOn", "isOn"],
    ]);
  });

  it("applies what the setter computes", () => {
    expect(getEdges("CyclingSink")).toEqual([
      ["step === 2", "step !== 2"],
      ["step !== 2", "step === 2"],
    ]);
  });
});
