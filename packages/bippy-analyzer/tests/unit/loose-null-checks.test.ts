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
