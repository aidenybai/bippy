import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("updates queued in one handler", () => {
  const project = analyzeFixture("conformance-repros", "chained-updaters");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("give each updater the value the update before it queued", () => {
    expect(getTargets("ChainedUpdaters")).toEqual([[[1]], [[2]], [[2]]]);
    expect(getTargets("ValueThenUpdater")).toEqual([[[1]], [[1]], [[1]]]);
  });

  it("give each reducer call the state the dispatch before it queued", () => {
    expect(getTargets("ChainedDispatches")).toEqual([[[1]], [[2]], [[2]]]);
  });

  it("leave the updater's value open when the update before it may not have run", () => {
    expect(getTargets("GuardedThenUpdater")).toEqual([[[1, 2]], [[1, 2]], [[1, 2]]]);
  });
});
