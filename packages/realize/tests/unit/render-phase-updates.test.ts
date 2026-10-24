import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("updates during render", () => {
  const project = analyzeFixture("conformance-repros", "render-phase-updates");

  const getReport = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    return {
      triggers: analysis.handlers.map((handler) => handler.trigger.kind),
      firstRender: report.regions.map((region) => region.firstRenderState),
      states: report.states.map((state) => [
        state.conditions,
        state.transitions.map((transition) => transition.targets),
      ]),
    };
  };

  it("never shows a render that calls a setter", () => {
    expect(getReport("RenderPhase")).toEqual({
      triggers: ["Render", "Event"],
      firstRender: [0],
      states: [[["previousCount === count"], [[0]]]],
    });
  });

  it("keeps a render update whose guard reads a prop open", () => {
    expect(getReport("ResetOnChange")).toEqual({
      triggers: ["Render", "Event"],
      firstRender: [1],
      states: [
        [["isOpen && previousId === itemId"], [[0]]],
        [["!(isOpen && previousId === itemId)"], [[0, 1]]],
      ],
    });
  });

  it("moves a region whose render update reads a state a handler sets", () => {
    expect(getReport("CopiedDuringRender").states).toEqual([
      [["copy"], [[0]]],
      [["!copy"], [[0]]],
    ]);
  });
});
