import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler read from a class instance field", () => {
  const project = analyzeFixture("conformance-repros", "instance-handlers");

  it.each(["ParamField", "AssignedField", "ChosenField", "ChosenCallResult"])(
    "lets a click in %s run the field that sets 2",
    (name) => {
      const { analysis, report } = getComponent(project, name);
      const eventIds = new Set(
        analysis.handlers
          .filter((handler) => handler.trigger.kind === "Event")
          .map((handler) => handler.id),
      );
      const twoIndex = report.states.findIndex((state) => state.conditions.includes("n === 2"));
      expect(
        report.states.some((state) =>
          state.transitions.some(
            (transition) =>
              eventIds.has(transition.handlerId) && transition.targets.includes(twoIndex),
          ),
        ),
      ).toBe(true);
    },
  );
});
