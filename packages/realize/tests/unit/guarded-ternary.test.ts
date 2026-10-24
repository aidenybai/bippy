import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("guarded ternary", () => {
  const project = analyzeFixture("conformance-repros", "guarded-ternary");

  it("claims no side of a ternary unreachable when it renders only behind another test", () => {
    expect(getComponent(project, "DateRangeLabel").report.unreachableBranches).toEqual([]);
  });
});
