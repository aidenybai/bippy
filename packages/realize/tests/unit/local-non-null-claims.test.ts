import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("non-null claims on locals", () => {
  const project = analyzeFixture("conformance-repros", "local-non-null-claims");

  const getOutcomes = (name: string) =>
    getComponent(project, name).report.claimOutcomes.map((outcome) => [
      outcome.claim.description,
      outcome.verdict,
    ]);

  it.each(["TernaryLocal", "AnnotatedLocal", "InlineTernary", "StatementLocal"])(
    "records the claim a ! makes on a local that can be undefined in %s",
    (name) => {
      expect(getOutcomes(name)).toEqual([["isOn ? label : undefined!", "unproven"]]);
    },
  );
});
