import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a callback that keeps a value its dependencies leave out", () => {
  const project = analyzeFixture("conformance-repros", "stale-unknown-captures");

  it("does not tie a stale unknown to the current render's", () => {
    const { states } = getComponent(project, "StaleDerivedCallback").report;
    const edges = states.flatMap((state, index) =>
      state.transitions.flatMap((transition) =>
        transition.targets
          .filter((target) => target !== index)
          .map((target) => [
            state.conditions.join(" && "),
            states[target]?.conditions.join(" && "),
          ]),
      ),
    );
    expect(edges).toContainEqual(["!isOn && count !== 0 && Unknown(memo)", "!isOn && count === 0"]);
  });
});
