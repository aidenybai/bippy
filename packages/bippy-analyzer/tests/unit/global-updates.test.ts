import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an increment of a module variable", () => {
  const project = analyzeFixture("conformance-repros", "global-updates");

  it("compiles and shows on the next render", () => {
    const { analysis, report } = getComponent(project, "IncrementedGlobal");
    expect(analysis.bailouts).toEqual([]);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual([
      "!(clicks > 0)",
    ]);
    expect(report.states.flatMap((state) => state.transitions)).not.toEqual([]);
  });
});
