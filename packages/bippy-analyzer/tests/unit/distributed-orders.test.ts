import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("distributed order comparisons", () => {
  const project = analyzeFixture("conformance-repros", "distributed-orders");

  it("narrows through a conditional compared with an order operator", () => {
    const outcome = getComponent(project, "TonedText").report.claimOutcomes.find(
      (candidate) => candidate.claim.description === "line.emphasis!",
    );
    expect(outcome).toMatchObject({ verdict: "holds" });
  });
});
