import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a callback the component keeps from its first render", () => {
  const project = analyzeFixture("conformance-repros", "own-held-callbacks");

  const isOneReachedFromMany = (name: string): boolean => {
    const { states } = getComponent(project, name).report;
    const oneIndex = states.findIndex((state) => state.conditions.includes("n === 1"));
    return states
      .filter((state) => state.conditions.includes("n >= 2"))
      .some((state) =>
        state.transitions.some((transition) => transition.targets.includes(oneIndex)),
      );
  };

  it.each(["StaleMemoObject", "ReducerHeld"])("lets %s run the first-render callback", (name) => {
    expect(isOneReachedFromMany(name)).toBe(true);
  });

  it("runs the latest callback from a memo that lists its reads", () => {
    expect(isOneReachedFromMany("FreshMemoObject")).toBe(false);
  });
});
