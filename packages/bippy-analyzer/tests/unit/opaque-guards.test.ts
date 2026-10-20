import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("opaque guards", () => {
  const project = analyzeFixture("conformance-repros", "opaque-guards");

  const getCast = (name: string) =>
    getComponent(project, name).report.claimOutcomes.find(
      (outcome) => outcome.claim.kind === "cast",
    );

  it("leaves a cast unproven when a call over its subject guards it", () => {
    expect(getCast("PartInspector")).toMatchObject({
      verdict: "unproven",
      reason: 'item.kind = "splitButton"',
    });
  });

  it("still breaks a cast its own guard contradicts", () => {
    expect(getCast("PlainInspector")).toMatchObject({ verdict: "broken" });
  });
});
