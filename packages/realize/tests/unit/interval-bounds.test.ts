import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an update whose value ranges over the source state's values", () => {
  const project = analyzeFixture("conformance-repros", "interval-bounds");

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

  it("keeps a clamp at its maximum", () => {
    expect(getEdges("ClampedMax")).toEqual([
      ["count >= 5", "count < 5"],
      ["count < 5", "count >= 5"],
    ]);
  });

  it("keeps a clamp at its minimum", () => {
    expect(getEdges("ClampedMin")).toEqual([
      ["count > 0", "count <= 0"],
      ["count <= 0", "count > 0"],
    ]);
  });

  it("keeps a guarded increment on the last page", () => {
    expect(getEdges("LastPage")).toEqual([
      ["page + 1 >= 3", "page + 1 < 3"],
      ["page + 1 < 3", "page + 1 >= 3"],
    ]);
  });
});

describe("a render-phase update", () => {
  const project = analyzeFixture("react-tests", "render-phase-updates");

  it.each(["RestartsUntilStable", "RenderPhaseReducer"])(
    "%s still settles on the value React commits",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.regions.flatMap((region) => region.possibleFirstRenderStates)).toEqual([0]);
    },
  );
});
