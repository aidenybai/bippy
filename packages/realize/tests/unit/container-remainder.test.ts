import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("functions read back out of a ref field, Object.values or Map values", () => {
  const project = analyzeFixture("conformance-repros", "container-remainder");

  const getEventEdges = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    const handlerIds = new Set(
      analysis.handlers
        .filter(
          (handler) =>
            handler.trigger.kind === "Event" &&
            handler.updates.some((update) => update.binding.name === "isOn" && !update.isAsync),
        )
        .map((handler) => handler.id),
    );
    return report.states.flatMap((state, index) =>
      state.transitions
        .filter((transition) => handlerIds.has(transition.handlerId))
        .flatMap((transition) =>
          transition.targets
            .filter((target) => target !== index)
            .map((target) => [
              state.conditions.join(" && "),
              report.states[target]?.conditions.join(" && "),
            ]),
        ),
    );
  };

  it.each(["RefFieldListener", "RefObjectValues", "MapValuesLoop"])(
    "%s toggles from the button that calls it",
    (name) => {
      expect(getEventEdges(name)).toEqual([
        ["isOn", "!isOn"],
        ["!isOn", "isOn"],
      ]);
    },
  );
});
