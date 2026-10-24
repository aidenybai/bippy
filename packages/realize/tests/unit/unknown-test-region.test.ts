import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("unknown test region", () => {
  it("lets any handler change a region whose test reads an unknown value", () => {
    const project = analyzeFixture("conformance-repros", "unknown-test-region");
    const { report } = getComponent(project, "PetSelection");
    const transitionTargets = report.states.flatMap((state) =>
      state.transitions.flatMap((transition) => transition.targets),
    );
    expect(new Set(transitionTargets).size).toBe(report.states.length);
  });
});
