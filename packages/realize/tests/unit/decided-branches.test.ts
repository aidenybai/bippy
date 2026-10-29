import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("decided branches", () => {
  it("counts a branch side the interpreter decided as reached", () => {
    const project = analyzeFixture("conformance-repros", "implicit-return");
    expect(getComponent(project, "BangPath").report.unreachableBranches).toEqual([]);
  });
});
