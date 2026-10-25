import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an update that scales a number by a constant", () => {
  const project = analyzeFixture("conformance-repros", "scaled-intervals");

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

  it("keeps the sign of a doubled count", () => {
    expect(getEdges("DoubledCount")).toEqual([["count > 0", "count <= 0"]]);
  });

  it("keeps a halved count from turning negative", () => {
    expect(getEdges("HalvedCount")).not.toContainEqual(["count >= 0", "count < 0"]);
  });

  it("still lets a halved count underflow to zero", () => {
    expect(getEdges("HalvedToZero")).toContainEqual(["count > 0 && count < 1", "count <= 0"]);
  });
});
