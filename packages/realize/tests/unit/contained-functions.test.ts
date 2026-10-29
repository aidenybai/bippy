import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a function a handler calls out of a state, memo or ref container", () => {
  const project = analyzeFixture("conformance-repros", "contained-functions");

  const getSyncEdges = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    const syncHandlerIds = new Set(
      analysis.handlers
        .filter((handler) =>
          handler.updates.some((update) => update.binding.name === "isOn" && !update.isAsync),
        )
        .map((handler) => handler.id),
    );
    return report.states.flatMap((state, index) =>
      state.transitions
        .filter((transition) => syncHandlerIds.has(transition.handlerId))
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

  it.each([
    "MemoActions",
    "LazyStateActions",
    "LazyStateList",
    "FilledList",
    "FilledMap",
    "RefListeners",
  ])("%s toggles through the call", (name) => {
    expect(getSyncEdges(name)).toEqual([
      ["isOn", "!isOn"],
      ["!isOn", "isOn"],
    ]);
  });
});
