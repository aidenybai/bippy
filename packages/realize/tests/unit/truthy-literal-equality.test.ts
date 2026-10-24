import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("strict equality against a literal of the other truthiness", () => {
  const project = analyzeFixture("conformance-repros", "truthy-literal-equality");

  for (const name of ["OrFallback", "TernaryFallback", "HelperFallback"]) {
    it(`${name} never equals the empty string`, () => {
      const { report } = getComponent(project, name);
      expect(report.states.map((state) => state.conditions)).toEqual([
        ['(label || "fallback") !== ""'],
      ]);
      expect(report.unreachableBranches).toHaveLength(1);
    });
  }

  it("loose equality keeps both outcomes", () => {
    const { report } = getComponent(project, "LooseFallback");
    expect(report.states).toHaveLength(2);
    expect(report.unreachableBranches).toHaveLength(0);
  });
});
