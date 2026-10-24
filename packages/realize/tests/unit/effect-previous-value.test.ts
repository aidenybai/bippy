import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an effect that reads a value and then writes it", () => {
  const project = analyzeFixture("conformance-repros", "effect-previous-value");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

  it("reads a ref before its own write", () => {
    expect(getTargets("PreviousCountRef", "!wentUp")).toContainEqual(["wentUp"]);
  });

  it("reads a component let before its own write", () => {
    expect(getTargets("PreviousCountLet", "!wentUp")).toContainEqual(["wentUp"]);
  });

  it("doesn't read the cleanup's write in the same run", () => {
    expect(getTargets("PreviousCountCleanup", "!wentUp")).toContainEqual(["wentUp"]);
  });
});
