import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("unknown tests", () => {
  const project = analyzeFixture("conformance-repros", "unknown-tests");

  it("doesn't decide one unknown test by another that prints alike", () => {
    const status = getComponent(project, "QueryStatus");
    expect(status.report.unreachableBranches).toEqual([]);
    expect(status.report.states).toHaveLength(3);
  });
});
