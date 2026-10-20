import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparisons with a conditional", () => {
  const project = analyzeFixture("conformance-repros", "nullish-fallbacks");

  it("compares each arm of a conditional, so a fallback's test implies the branch it took", () => {
    const { report } = getComponent(project, "UsageLink");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['app === "openclaw"', "(isSupported(app) ? app : null) != null"],
      ['app === "openclaw"', "(isSupported(app) ? app : null) == null"],
      ['app !== "openclaw"', "(isSupported(app) ? app : null) != null"],
      ['app !== "openclaw"', "(isSupported(app) ? app : null) == null"],
    ]);
  });
});
