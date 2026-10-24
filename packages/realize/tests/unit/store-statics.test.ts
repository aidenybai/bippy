import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a zustand store", () => {
  const project = analyzeFixture("conformance-repros", "store-statics");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state) =>
      state.transitions.flatMap((transition) =>
        transition.targets.map((target) => [
          state.conditions.join(" && "),
          states[target]?.conditions.join(" && "),
        ]),
      ),
    );
  };

  const getFirstConditions = (name: string) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    return firstState === null ? null : report.states[firstState]?.conditions;
  };

  it.each(["GetStateToggle", "SetStateUpdater"])("%s updates through the static API", (name) => {
    expect(getEdges(name)).toEqual([
      ["usePanel().open", "!usePanel().open"],
      ["!usePanel().open", "usePanel().open"],
    ]);
  });

  it("starts from the literal fields of the store", () => {
    expect(getFirstConditions("GetStateToggle")).toEqual(["!usePanel().open"]);
  });

  it("keeps an action it cannot summarize from dropping into an earlier update", () => {
    expect(getEdges("ResetThenFlip")).toContainEqual([
      "useCounter().on && useCounter().count === 1",
      "useCounter().on && useCounter().count !== 1",
    ]);
  });

  it("starts from array fields of the store", () => {
    expect(getFirstConditions("EmptyItems")).toEqual(["useCounter().items.length <= 0"]);
  });

  it.each(["TwoActions", "TwoSetStates"])("%s applies both updates from one handler", (name) => {
    expect(getEdges(name)).toContainEqual([
      "!usePanel().open && !usePanel().pinned",
      "usePanel().open && usePanel().pinned",
    ]);
  });
});
