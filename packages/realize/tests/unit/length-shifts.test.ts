import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an update that appends to a list or string", () => {
  const project = analyzeFixture("conformance-repros", "length-shifts");

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

  it("keeps a list filled through concat", () => {
    expect(getEdges("ConcatList")).toEqual([
      ["items.length > 0", "items.length <= 0"],
      ["items.length <= 0", "items.length > 0"],
    ]);
  });

  it("keeps text typed through an append", () => {
    expect(getEdges("AppendedText")).toEqual([
      ["text.length > 0", "text.length <= 0"],
      ["text.length <= 0", "text.length > 0"],
    ]);
  });
});
