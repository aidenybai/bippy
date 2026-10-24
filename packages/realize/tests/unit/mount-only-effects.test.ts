import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("effects with an empty deps list", () => {
  const project = analyzeFixture("conformance-repros", "mount-only-effects");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("runs a mount-only effect from the first render with its initial values", () => {
    expect(getTargets("MountOnly")).toEqual([[], [[1]]]);
  });

  it("runs an effect whose deps name a state after that state changes", () => {
    expect(getTargets("OnModeChange")).toEqual([[[0]], [[0, 1]]]);
  });

  it("applies a mount-only effect's unconditional write", () => {
    expect(getTargets("MountOnlyWrite")).toEqual([[], [[0]]]);
  });
});
