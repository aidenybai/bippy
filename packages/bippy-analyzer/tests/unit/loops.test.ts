import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getBinding, getComponent, getFixtureConfig } from "./helpers";

describe("loops", () => {
  const project = analyzeProject(getFixtureConfig("symbolic-tree"), "loops");
  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("types a flag a loop sets as declared, so both of its sides render", () => {
    const component = getComponent(project, "LoopList");
    expect(getBinding(component, "hasLong").domain).toEqual({
      kind: "Cases",
      cases: [
        { kind: "Literal", value: false },
        { kind: "Literal", value: true },
      ],
      origin: "type",
    });
    expect(component.analysis.bailouts).toEqual([]);
  });

  it("runs the setter a handler calls inside a loop", () => {
    const component = getComponent(project, "LoopList");
    expect(component.report.unreachableBranches).toEqual([]);
    expect(component.analysis.handlers[0]?.updates).toHaveLength(1);
  });

  it("keeps what a loop leaves through `break`", () => {
    expect(getConditions("FirstMatch")).toEqual([["found === null"], ["found !== null"]]);
  });

  it("doesn't decide a loop's own test after the loop", () => {
    expect(getConditions("Countdown")).toEqual([["steps === 0"], ["steps !== 0"]]);
  });
});
