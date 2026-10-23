import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getBinding, getComponent } from "./helpers";

describe("loops", () => {
  const project = analyzeFixture("symbolic-tree", "loops");
  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

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

  it("runs a handler's loop with known bounds to its end", () => {
    expect(getTargets("CountedLoop", "!isDone")).toEqual([["isDone"]]);
    expect(getTargets("CountedLoop", "isDone")).toEqual([["isDone"]]);
  });

  it("follows `continue` through a do-while loop", () => {
    const { report } = getComponent(project, "SkippedSteps");
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never steps !== 3",
    ]);
  });

  it("leaves a loop through `return`", () => {
    const { report } = getComponent(project, "EarlyReturn");
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never picked !== 3",
    ]);
  });

  it("keeps both results of a loop that runs too long to follow", () => {
    expect(getTargets("LongLoop", "isFull")).toEqual([["isFull"], ["!isFull"]]);
  });
});
