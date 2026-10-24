import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setter reached through calls the interpreter doesn't inline", () => {
  const project = analyzeFixture("conformance-repros", "deep-setter-calls");
  const getReachedConditions = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.flatMap((target) => states[target]?.conditions ?? []),
    );
  };

  it("still updates its state past the inline depth", () => {
    expect(getReachedConditions("DeepSetterChain", "n !== 1")).toContain("n === 1");
  });

  it("still updates its state through a recursive call", () => {
    expect(getReachedConditions("RecursiveSetter", "n !== 2")).toContain("n === 2");
  });
});
