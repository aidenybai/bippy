import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("reads through an index signature", () => {
  const project = analyzeFixture("conformance-repros", "indexed-reads");
  const label = getComponent(project, "KeyLabel");

  it("may be undefined, since the type promises no key exists", () => {
    expect(label.report.unreachableBranches).toEqual([]);
    expect(label.report.states).toHaveLength(2);
  });

  it("lets a prop destructured with a default be undefined, which its type leaves out", () => {
    const label = getComponent(project, "RangeLabel");
    expect(label.report.unreachableBranches).toEqual([]);
  });
});
