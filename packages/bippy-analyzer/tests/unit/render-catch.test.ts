import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("render catch", () => {
  it("keeps the value a catch block returns during render", () => {
    const project = analyzeFixture("conformance-repros", "render-catch");
    const { report } = getComponent(project, "ColorPreview");
    expect(report.unreachableBranches).toEqual([]);
    expect(report.states.length).toBeGreaterThan(1);
  });
});
