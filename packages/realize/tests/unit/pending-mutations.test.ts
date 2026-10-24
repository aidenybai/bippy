import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a mutation whose handler skips the render", () => {
  const project = analyzeFixture("conformance-repros", "pending-mutations");

  const getTickTargets = (name: string) => {
    const component = getComponent(project, name);
    const tickHandler = component.analysis.handlers.find((handler) =>
      handler.updates.some((update) => update.binding.name === "tick"),
    );
    return component.report.states.map((state) =>
      state.transitions
        .filter((transition) => transition.handlerId === tickHandler?.id)
        .flatMap((transition) => transition.targets)
        .map((target) => component.report.states[target]?.conditions.join(" && ")),
    );
  };

  it.each(["SameObjectSet", "MutatingReducer", "PushWithoutSet"])(
    "%s shows it on the next render from another handler",
    (name) => {
      for (const targets of getTickTargets(name)) expect(targets).toHaveLength(2);
    },
  );
});
