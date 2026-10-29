import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("spreading props chosen by a condition", () => {
  const project = analyzeFixture("conformance-repros", "chosen-spread-handlers");

  const getGuardedUpdates = (name: string, skipped: string) =>
    getComponent(project, name)
      .analysis.handlers.flatMap((handler) => handler.updates)
      .filter((update) => update.binding.name !== skipped)
      .map((update) => [update.binding.name, update.guards.map(formatSymbolicValue)]);

  for (const name of ["SpreadVariable", "SpreadInline"]) {
    it(`${name} runs each arm's handler under its test`, () => {
      expect(getGuardedUpdates(name, "isLeft")).toEqual([
        ["left", ["isLeft"]],
        ["right", ["!isLeft"]],
      ]);
    });
  }

  it("runs a handler that only one arm provides under that arm's test", () => {
    expect(getGuardedUpdates("SpreadOneArm", "isOn")).toEqual([["count", ["isOn"]]]);
  });
});

describe("spreading props with several event handlers", () => {
  const project = analyzeFixture("conformance-repros", "spread-handler-events");

  it("runs one handler per event instead of all of them in a row", () => {
    const { report } = getComponent(project, "ConfirmDelete");
    expect(report.states.map((state) => state.conditions)).toEqual([["isArmed"], ["!isArmed"]]);
    expect(
      report.states.map((state) => state.transitions.map((transition) => transition.targets)),
    ).toEqual([[[0, 1]], [[0, 1]]]);
  });
});
