import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("Set and Map state", () => {
  const project = analyzeFixture("conformance-repros", "collection-state");

  const getFirstRender = (name: string) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    return firstState === null ? null : report.states[firstState]?.conditions;
  };

  it("reads size and has from a literal Set", () => {
    expect(getFirstRender("SelectedIds")).toEqual(["ids.size !== 0", "!ids.has(1)"]);
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

  it("leaves get on other classes open", () => {
    expect(getFirstRender("SearchQuery")).toBeNull();
  });
});
