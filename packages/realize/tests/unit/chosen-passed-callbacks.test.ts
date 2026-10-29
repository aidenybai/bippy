import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a callback chosen by a condition and passed on", () => {
  const project = analyzeFixture("conformance-repros", "chosen-passed-callbacks");

  const getGuardedUpdates = (name: string) =>
    getComponent(project, name)
      .analysis.handlers.flatMap((handler) => handler.updates)
      .filter((update) => update.binding.name !== "isLeft")
      .map((update) => [update.binding.name, update.guards.map(formatSymbolicValue)]);

  for (const name of ["ThenChosen", "ForEachChosen", "MicrotaskChosen"]) {
    it(`${name} runs each arm under its test`, () => {
      expect(getGuardedUpdates(name)).toEqual([
        ["left", expect.arrayContaining(["isLeft"])],
        ["right", expect.arrayContaining(["!isLeft"])],
      ]);
      const { report } = getComponent(project, name);
      expect(report.states.map((state) => state.conditions[0])).toEqual([
        "left === 1 && right === 0",
        "!(left === 1 && right === 0)",
        "!(left === 1 && right === 0)",
      ]);
    });
  }
});
