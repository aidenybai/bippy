import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers inside memoized JSX", () => {
  const project = analyzeFixture("conformance-repros", "memo-jsx-handlers");

  const getTargets = (name: string) =>
    getComponent(project, name).report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );

  it("are collected when the memo reads loop items it does not list", () => {
    expect(getComponent(project, "TopicGrid").report.states).toHaveLength(2);
    expect(getTargets("TopicGrid")[0]).toEqual([[0, 1]]);
  });

  it("call a listed callback with its current reads", () => {
    expect(getTargets("CallbackGrid")).toEqual([[[1]], [[1]]]);
  });

  it("read state the memo does not list as unknown", () => {
    expect(getTargets("FrozenToggle")).toEqual([[[0, 1]], [[0, 1]]]);
  });

  it("keeps the updates of a listed helper a callback calls", () => {
    expect(getTargets("ListedHelperCallback")).toEqual([[[1]], [[1]]]);
  });

  it("keeps a function declared after a stale callback live", () => {
    expect(getComponent(project, "LateDeclaredClose").report.states).toHaveLength(2);
  });
});
