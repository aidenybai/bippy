import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an offset update keeps the bound its source state had", () => {
  const project = analyzeFixture("conformance-repros", "shifted-bounds");

  const getEdges = (name: string) => {
    const { states } = getComponent(project, name).report;
    return states.flatMap((state, index) =>
      state.transitions.flatMap((transition) =>
        transition.targets
          .filter((target) => target !== index)
          .map((target) => [
            state.conditions.join(" && "),
            states[target]?.conditions.join(" && "),
          ]),
      ),
    );
  };

  it("doesn't let count + 1 leave count > 0", () => {
    expect(getEdges("PositiveBadge")).toEqual([
      ["count > 0", "count <= 0"],
      ["count <= 0", "count > 0"],
    ]);
  });

  it("still lets updaters queued in a loop move past the first offset", () => {
    expect(getEdges("LoopedOffsets")).toContainEqual(["n === 1", "n !== 1 && n !== 2"]);
  });

  it("doesn't let count - 2 leave count < 5", () => {
    expect(getEdges("BelowLimit")).toEqual([
      ["count < 5", "count >= 5"],
      ["count >= 5", "count < 5"],
    ]);
  });
});
