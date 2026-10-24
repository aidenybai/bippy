import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("ts-pattern match", () => {
  const project = analyzeFixture("symbolic-tree", "pattern-match.tsx");

  it("turns each arm into a branch on the subject and the otherwise arm into the rest", () => {
    const status = getComponent(project, "StatusView");
    expect(status.analysis.bailouts).toEqual([]);
    expect(status.report.states.map((state) => state.conditions)).toEqual([
      ['status === "idle"'],
      ['status !== "idle"', 'status === "loading"'],
      ['status !== "idle"', 'status !== "loading"'],
    ]);
    expect(status.report.states.map((state) => state.transitions)).toEqual([
      [{ handlerId: "t1", targets: [1], isAsync: false }],
      [{ handlerId: "t2", targets: [2], isAsync: false }],
      [],
    ]);
  });

  it("tests an object pattern by field and keeps the last exhaustive arm unconditional", () => {
    const step = getComponent(project, "StepView");
    expect(step.analysis.bailouts).toEqual([]);
    expect(step.report.states.map((state) => state.conditions)).toEqual([
      ['step === "panel"'],
      ['step !== "panel"'],
      ["!!user"],
      ["!user"],
    ]);
  });

  it("narrows the subject of a Boolean() match inside the true arm", () => {
    const step = getComponent(project, "StepView");
    const assertion = step.report.claimOutcomes.find(
      (outcome) => outcome.claim.kind === "non-null",
    );
    expect(assertion).toMatchObject({ verdict: "holds" });
  });
});
