import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler read from a class instance field", () => {
  const project = analyzeFixture("conformance-repros", "instance-handlers");

  it.each(["ParamField", "AssignedField", "ChosenField"])(
    "lets %s run the field that sets 2",
    (name) => {
      const { states } = getComponent(project, name).report;
      const twoIndex = states.findIndex((state) => state.conditions.includes("n === 2"));
      expect(
        states.some((state) =>
          state.transitions.some((transition) => transition.targets.includes(twoIndex)),
        ),
      ).toBe(true);
    },
  );
});
