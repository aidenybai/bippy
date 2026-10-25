import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a class instance a ref keeps", () => {
  const project = analyzeFixture("conformance-repros", "ref-instances");

  const getEdges = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    const handlerIds = new Set(
      analysis.handlers
        .filter((handler) => handler.updates.some((update) => update.binding.name === "isOn"))
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

  it.each(["InitialRefInstance", "LazyRefInstance", "LazyRefArrowInstance"])(
    "%s still runs the callbacks it was built with",
    (name) => {
      expect(getEdges(name)).toEqual([
        ["isOn", "!isOn"],
        ["!isOn", "isOn"],
      ]);
    },
  );
});
