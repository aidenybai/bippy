import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("invariant claims", () => {
  const project = analyzeFixture("conformance-repros", "invariant-claims");

  const getOutcomes = (name: string) =>
    getComponent(project, name).report.claimOutcomes.map((outcome) => [
      outcome.claim.description,
      outcome.verdict,
      outcome.reason,
    ]);

  it("records an invariant on a number", () => {
    expect(getOutcomes("InvariantCount")).toEqual([
      ["invariant(count < 3)", "unproven", "can't be decided"],
    ]);
  });

  it("records an invariant on a string's length", () => {
    expect(getOutcomes("InvariantLength")).toEqual([
      ["invariant(name.length > 0)", "unproven", "can't be decided"],
    ]);
  });

  it("records an invariant on a ref", () => {
    expect(getOutcomes("InvariantRef")).toEqual([
      ["invariant(box.current !== null)", "unproven", "can't be decided"],
    ]);
  });
});
