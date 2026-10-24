import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("Set and Map state", () => {
  const project = analyzeFixture("conformance-repros", "collection-state");

  const getFirstRender = (name: string) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    return firstState === null ? null : report.states[firstState]?.conditions;
  };

  it("reads size and has from a literal Set", () => {
    expect(getFirstRender("SelectedIds")).toEqual(["!ids.has(1)"]);
  });

  it("reads get from a literal Map", () => {
    expect(getFirstRender("Scores")).toEqual(['scores.get("a") === 1']);
  });

  it("reads a Set filled after it is created", () => {
    expect(getFirstRender("FilledSet")).toEqual(['seen.has("x")']);
  });

  it("applies writes made on the path that created the Set", () => {
    const { report } = getComponent(project, "LocalSet");
    const conditions = report.states.map((state) => state.conditions.join(" ∧ "));
    expect(conditions).toEqual(['sometimes.has("y")', '!sometimes.has("y")']);
  });

  it("keeps the collection that add and set return", () => {
    const getUpdateTexts = (name: string) =>
      getComponent(project, name).analysis.handlers.flatMap((handler) =>
        handler.updates.map((update) => formatSymbolicValue(update.value)),
      );
    expect(getUpdateTexts("SelectedIds")).toEqual(["new Set(ids).add(1)"]);
    expect(getUpdateTexts("Scores")).toEqual(['new Map(scores).set("a", 2)']);
  });

  const getStates = (name: string) =>
    getComponent(project, name).report.states.map((state) => ({
      conditions: state.conditions,
      targets: state.transitions.flatMap((transition) => transition.targets),
    }));

  it("follows add and set to the contents they reach", () => {
    expect(getStates("SelectedIds")).toEqual([
      { conditions: ["ids.has(1)"], targets: [0] },
      { conditions: ["!ids.has(1)"], targets: [0] },
    ]);
    expect(getStates("Scores")).toEqual([
      { conditions: ['scores.get("a") === 1'], targets: [1] },
      { conditions: ['scores.get("a") !== 1'], targets: [1] },
    ]);
  });

  it("empties a Set replaced with a new one", () => {
    expect(getStates("FilledSet")).toEqual([
      { conditions: ['seen.has("x")'], targets: [1] },
      { conditions: ['!seen.has("x")'], targets: [1] },
    ]);
  });

  it("toggles a key with writes under a branch", () => {
    expect(getStates("ToggledTag")).toEqual([
      { conditions: ['tags.has("a")'], targets: [1] },
      { conditions: ['!tags.has("a")'], targets: [0] },
    ]);
  });

  it("leaves get on other classes open", () => {
    expect(getFirstRender("SearchQuery")).toBeNull();
  });
});
