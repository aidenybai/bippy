import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("projects without strictNullChecks", () => {
  const project = analyzeFixture("loose");

  it("lets an optional prop be undefined, which its type leaves out", () => {
    const button = getComponent(project, "DialogButton");
    expect(button.report.unreachableBranches).toEqual([]);
    expect(button.report.states).toHaveLength(2);
  });

  it("lets a call's result be undefined, which its return type leaves out", () => {
    expect(getComponent(project, "ThemeLabel").report.unreachableBranches).toEqual([]);
  });
});

describe("claims without strictNullChecks", () => {
  const { report } = getComponent(analyzeFixture("loose", "orientation.tsx"), "ReplayFrame");

  it("let a typed state be null, since every type holds null and undefined", () => {
    const state = report.claimOutcomes.find((outcome) => outcome.claim.kind === "state");
    expect(state).toMatchObject({ verdict: "holds" });
  });

  it("let a cast hold null for the same reason", () => {
    const cast = report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "holds" });
  });
});
