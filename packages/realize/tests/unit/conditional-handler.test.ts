import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("conditional handler", () => {
  it("runs both handlers a conditional event prop can pick", () => {
    const project = analyzeFixture("conformance-repros", "conditional-handler");
    const { report } = getComponent(project, "PlayResetButton");
    expect(report.unreachableBranches).toEqual([]);
  });
});
