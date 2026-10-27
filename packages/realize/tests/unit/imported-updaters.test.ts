import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an updater, init function, reducer or default object imported from another file", () => {
  const project = analyzeFixture("conformance-repros", "imported-updaters");

  const getShape = (name: string) => {
    const { report } = getComponent(project, name);
    return {
      firstRender: report.regions.map((region) => region.firstRenderState),
      states: report.states.map((state) => ({
        conditions: state.conditions,
        targets: state.transitions.map((transition) => transition.targets),
      })),
    };
  };

  it.each([
    ["ImportedUpdater", "LocalUpdater"],
    ["ImportedDefaults", "LocalDefaults"],
    ["ImportedInit", "LocalInit"],
    ["ImportedReducer", "LocalReducer"],
  ])("gives %s the same states as %s", (imported, local) => {
    expect(getShape(imported)).toEqual(getShape(local));
    expect(getShape(imported).firstRender).toEqual([0]);
  });
});
