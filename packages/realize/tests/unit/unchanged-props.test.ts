import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a condition on a prop a handler doesn't change", () => {
  const { report } = getComponent(
    analyzeFixture("symbolic-tree", "unchanged-props.tsx"),
    "ToneCounter",
  );

  it("still holds after the handler runs", () => {
    expect(
      report.states.map((state) => [
        state.conditions,
        state.transitions.flatMap((transition) => transition.targets),
      ]),
    ).toEqual([
      [['tone === "info"', "count > 0"], [0]],
      [['tone === "info"', "count <= 0"], [0]],
      [['tone !== "info"', "count > 0"], [2]],
      [['tone !== "info"', "count <= 0"], [2]],
    ]);
  });
});
