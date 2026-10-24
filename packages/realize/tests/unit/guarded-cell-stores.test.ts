import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a read after a store inside an if", () => {
  const project = analyzeFixture("conformance-repros", "guarded-cell-stores");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

  it("sees a ref store that may have run after an unconditional one", () => {
    expect(getTargets("GuardedRefStore", "!isAbove")).toContainEqual(["isAbove"]);
  });

  it("doesn't take a guarded let store as certain", () => {
    expect(getTargets("GuardedLetStore", "!isAbove")).toContainEqual(["!isAbove"]);
  });
});
