import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("arguments of a callback another component calls", () => {
  const { analysis, report } = getComponent(
    analyzeFixture("symbolic-tree", "callback-arguments.tsx"),
    "WarningFilter",
  );

  it("are unknown rather than missing", () => {
    const updates = analysis.handlers.flatMap((handler) => handler.updates);
    expect(updates.map((update) => formatSymbolicValue(update.value))).toEqual(["checked"]);
  });

  it("keep a boolean state within its type and let it reach both values", () => {
    expect(report.claimOutcomes).toMatchObject([{ verdict: "holds" }]);
    expect(report.states.map((state) => state.transitions.map((edge) => edge.targets))).toEqual([
      [[0, 1]],
      [[0, 1]],
    ]);
  });
});
