import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a setState during the first render", () => {
  const project = analyzeFixture("conformance-repros", "mount-render-updates");

  const getFirstRenderConditions = (name: string) => {
    const { report } = getComponent(project, name);
    const firstRender = report.regions[0]?.firstRenderState ?? -1;
    return report.states[firstRender]?.conditions;
  };

  it.each(["RenderSetOnMount", "RenderSetAlways"])(
    "%s settles before the first state shows",
    (name) => {
      expect(getFirstRenderConditions(name)).toEqual(["seen === -1"]);
    },
  );

  it("never leaves the settled state for the one before the update", () => {
    const { report } = getComponent(project, "RenderSetOnMount");
    expect(report.states[0]?.transitions.flatMap((transition) => transition.targets)).toEqual([0]);
  });
});
