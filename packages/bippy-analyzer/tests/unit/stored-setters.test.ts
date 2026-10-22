import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter kept somewhere and called later", () => {
  const project = analyzeFixture("conformance-repros", "stored-setters");

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

  it.each(["SetterInRef", "DispatchInRef", "SetterInModule"])("%s still updates", (name) => {
    expect(getEdges(name)).toEqual([
      ["isOn", "!isOn"],
      ["!isOn", "isOn"],
    ]);
  });
});
