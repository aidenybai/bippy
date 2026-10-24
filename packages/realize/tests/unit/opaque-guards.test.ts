import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("claims under opaque guards", () => {
  const project = analyzeFixture("conformance-repros", "opaque-guards");

  const getVerdicts = (name: string) =>
    getComponent(project, name).report.claimOutcomes.map(({ verdict, reason }) => ({
      verdict,
      reason,
    }));

  it("leaves a claim unproven when a guard checks its subject through a call it can't see into", () => {
    expect(getVerdicts("UsageLink")).toEqual([{ verdict: "unproven", reason: 'app = "openclaw"' }]);
  });

  it("still breaks a claim whose guard it can decide", () => {
    expect(getVerdicts("OpenLink")).toEqual([{ verdict: "broken", reason: 'app = "openclaw"' }]);
  });
});
