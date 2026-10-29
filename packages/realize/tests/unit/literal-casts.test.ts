import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("literal casts", () => {
  const project = analyzeFixture("conformance-repros", "literal-casts");

  it("decides a non-null assertion on a literal null", () => {
    const outcome = getComponent(project, "DragInput").report.claimOutcomes.find(
      (candidate) => candidate.claim.description === "null!",
    );
    expect(outcome).toMatchObject({ verdict: "broken" });
  });
});
