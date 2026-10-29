import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("the right side of &&", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "and-guards.tsx"),
    "PublishResult",
  );

  it("runs where the left side is truthy, so a claim there is guarded by it", () => {
    const assertion = report.claimOutcomes.find((outcome) => outcome.claim.kind === "non-null");
    expect(assertion?.claim.guards.map(formatSymbolicValue)).toEqual(["success"]);
    expect(assertion).toMatchObject({ verdict: "holds" });
  });

  it("guards a handler's update by the left side", () => {
    const update = analysis.handlers
      .flatMap((handler) => handler.updates)
      .find((candidate) => candidate.binding.name === "step");
    expect(update?.guards.map(formatSymbolicValue)).toEqual(["isReady"]);
  });
});
