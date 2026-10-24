import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a method call on an instance built with a setter", () => {
  const project = analyzeFixture("conformance-repros", "instance-method-callbacks");

  const getUpdatedBindings = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.binding.name),
    );

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.flatMap((transition) => transition.targets),
    );

  for (const name of ["ClassHandler", "LocalInstance"]) {
    it(`${name} may set the state the setter belongs to`, () => {
      expect(getUpdatedBindings(name)).toContain("isDone");
      expect(getTargets(name)).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });
  }
});
