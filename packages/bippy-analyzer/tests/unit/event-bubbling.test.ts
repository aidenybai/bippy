import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a click that bubbles to an ancestor's handler", () => {
  const project = analyzeFixture("conformance-repros", "event-bubbling");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  const getUpdateSequences = (name: string) =>
    getComponent(project, name).analysis.handlers.map((handler) =>
      handler.updates.map(
        (update) => `${update.binding.name} = ${formatSymbolicValue(update.value)}`,
      ),
    );

  it("runs the target's handler and then the ancestor's as one transition", () => {
    expect(getUpdateSequences("Bubbling")).toEqual([
      ["outer = true"],
      ["inner = true", "outer = true"],
    ]);
    expect(getTargets("Bubbling")).toEqual([
      [[0], [0]],
      [[0], [0]],
      [[2], [0]],
      [[2], [0]],
    ]);
  });

  it("stops at a handler that calls stopPropagation", () => {
    expect(getUpdateSequences("Stopped")).toEqual([["outer = true"], ["inner = true"]]);
    expect(getTargets("Stopped")[3]).toEqual([[2], [1]]);
  });

  it("runs an ancestor's capture handler before the target's", () => {
    expect(getUpdateSequences("Captured")).toEqual([
      ['order = "outer"'],
      ['order = "outer"', 'order = order + "-inner"'],
    ]);
  });
});
