import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a call to a type predicate over literals", () => {
  const { report } = getComponent(
    analyzeFixture("symbolic-tree", "type-predicates.tsx"),
    "PartInspector",
  );

  it("narrows its argument wherever its result is true", () => {
    const cast = report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "holds" });
  });

  it("splits states on the predicate, labelled by the kinds the state can reach", () => {
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['kind === "fab"'],
      ['kind !== "fab"'],
    ]);
  });
});
