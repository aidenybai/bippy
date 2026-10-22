import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("values clamped with Math.min and Math.max", () => {
  const project = analyzeFixture("conformance-repros", "clamp-ranges");

  const getTargets = (name: string, condition: string) => {
    const { report } = getComponent(project, name);
    const state = report.states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) => transition.targets) ?? [];
  };

  it("a step clamped to two never reaches three", () => {
    const { report } = getComponent(project, "ClampedStep");
    const past = report.states.findIndex((state) => state.conditions.includes("step === 3"));
    expect(past).not.toBe(-1);
    expect(getTargets("ClampedStep", "step !== 3")).not.toContain(past);
  });

  it("a step floored at zero never goes negative", () => {
    const { report } = getComponent(project, "ClampedFloor");
    const negative = report.states.findIndex((state) => state.conditions.includes("step < 0"));
    expect(negative).not.toBe(-1);
    expect(getTargets("ClampedFloor", "step >= 0")).not.toContain(negative);
  });

  it("a clamped value in render keeps its bound", () => {
    const { report } = getComponent(project, "ClampedSpan");
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches).toHaveLength(1);
  });
});
