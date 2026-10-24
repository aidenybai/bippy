import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("includes on a list of literals", () => {
  const project = analyzeFixture("conformance-repros", "literal-includes");

  it("narrows its argument like a membership test", () => {
    const { report } = getComponent(project, "PlanBadge");
    const cast = report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "holds" });
    expect(report.states).toHaveLength(3);
  });
});
