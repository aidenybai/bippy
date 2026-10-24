import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a module-level helper called from a handler", () => {
  const project = analyzeFixture("conformance-repros", "module-helpers");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  for (const name of ["ArrowHelper", "FunctionHelper"]) {
    it(`${name} toggles between the two values the helper returns`, () => {
      expect(getTargets(name)).toEqual([[[1]], [[0]]]);
    });
  }
});
