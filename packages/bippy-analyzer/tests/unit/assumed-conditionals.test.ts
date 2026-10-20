import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("assumed conditionals", () => {
  const project = analyzeFixture("conformance-repros", "assumed-conditionals");

  it("narrows an assumed || once its left side is known to be falsy", () => {
    const cast = getComponent(project, "QuickPick").report.claimOutcomes.find(
      (outcome) => outcome.claim.kind === "cast",
    );
    expect(cast).toMatchObject({ verdict: "holds" });
  });
});
