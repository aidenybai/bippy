import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("assuming an || or && condition", () => {
  const { report } = getComponent(
    analyzeFixture("symbolic-tree", "or-conditions.tsx"),
    "KindSwitch",
  );

  it("narrows each value to what either side allows", () => {
    const cast = report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "holds" });
  });

  it("decides a later test the earlier one already settled", () => {
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      expect.stringContaining('kind !== "chip"'),
    ]);
  });

  it("forgets a condition with an unknown part when anything updates", () => {
    const panel = getComponent(analyzeFixture("symbolic-tree", "or-conditions.tsx"), "SearchPanel");
    const [open] = panel.report.states;
    const click = panel.analysis.handlers.find(
      (handler) => handler.trigger.kind === "Event" && handler.trigger.event === "onClick",
    );
    const edge = open?.transitions.find((transition) => transition.handlerId === click?.id);
    expect(edge?.targets).toEqual([0, 1]);
  });
});
