import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a state initialized from another state's mount value", () => {
  const project = analyzeFixture("conformance-repros", "mount-snapshots");

  it("keeps the value it had at mount when nothing sets it", () => {
    const { report } = getComponent(project, "FrozenFlag");
    expect(report.states.map((state) => state.conditions)).toEqual([[]]);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  it("still changes when a handler sets it", () => {
    const { report } = getComponent(project, "UpdatedFlag");
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches).toHaveLength(0);
  });

  it("stays open when the initializer reads a prop", () => {
    const { report } = getComponent(project, "PropSnapshot");
    expect(report.states).toHaveLength(2);
  });
});
