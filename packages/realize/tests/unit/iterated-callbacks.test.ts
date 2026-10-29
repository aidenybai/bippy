import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a function a handler calls while iterating a literal collection", () => {
  const project = analyzeFixture("conformance-repros", "iterated-callbacks");

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

  it.each(["LoopedActions", "LoopedSetters", "SetOfSetters", "LoopedSetOfSetters"])(
    "%s still toggles",
    (name) => {
      expect(getEdges(name)).toEqual([
        ["isOn", "!isOn"],
        ["!isOn", "isOn"],
      ]);
    },
  );
});
