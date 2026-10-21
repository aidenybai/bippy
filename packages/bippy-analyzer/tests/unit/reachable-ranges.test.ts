import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("the reachable range of a numeric state", () => {
  const project = analyzeFixture("conformance-repros", "reachable-ranges");

  it("a counter that only grows never goes negative", () => {
    const { report } = getComponent(project, "Counter");
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  for (const name of ["ClampedPager", "GuardedPager"]) {
    it(`${name} visits exactly its three pages`, () => {
      const { report } = getComponent(project, name);
      expect(report.states.map((state) => state.conditions)).toEqual([
        ["page === 0"],
        ["page !== 0", "page === 1"],
        ["page !== 0", "page !== 1"],
      ]);
      expect(report.places.get({ bindingId: 0, path: [] })).toEqual([
        { kind: "Literal", value: 0 },
        { kind: "Literal", value: 1 },
        { kind: "Literal", value: 2 },
      ]);
    });
  }

  it("a conditional step stops at its limit", () => {
    const { report } = getComponent(project, "ConditionalStep");
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });
});
