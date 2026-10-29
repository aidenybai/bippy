import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a map over state after a set in the same handler", () => {
  const project = analyzeFixture("conformance-repros", "set-then-map");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const index = states.findIndex((state) => state.conditions.includes(condition));
    return states[index]?.transitions.flatMap((transition) =>
      transition.targets.map((target) => (target === index ? "self" : states[target]?.conditions)),
    );
  };

  it("keeps the rendered length, not the pending one", () => {
    expect(getTargets("SetThenMap", "items.length === 2")).toContain("self");
  });

  it("maps the rendered list after a clear", () => {
    expect(getTargets("ClearThenMap", "items.0 !== 2")).toContainEqual([
      "items.length !== 0",
      "items.0 === 2",
    ]);
  });
});
