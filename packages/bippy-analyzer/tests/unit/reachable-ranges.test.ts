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

describe("the render branches that guard a handler", () => {
  const project = analyzeFixture("conformance-repros", "reachable-ranges");

  it("bound the pager whose buttons render only in range", () => {
    const { report } = getComponent(project, "RenderedPager");
    expect(report.places.get({ bindingId: 0, path: [] })).toEqual([
      { kind: "Literal", value: 0 },
      { kind: "Literal", value: 1 },
      { kind: "Literal", value: 2 },
    ]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["page > 0", "page < 2"],
      ["page > 0", "page >= 2"],
      ["page <= 0"],
    ]);
  });

  it("bound the wizard whose next button hides on the last step", () => {
    const { report } = getComponent(project, "WizardSteps");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["index === 2"],
      ["index !== 2", "index === 0"],
      ["index !== 2", "index !== 0"],
    ]);
  });
});
