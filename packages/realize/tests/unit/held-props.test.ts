import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a child that holds an earlier callback prop", () => {
  const project = analyzeFixture("conformance-repros", "held-props");

  const isOneReachedFromMany = (name: string): boolean => {
    const { states } = getComponent(project, name).report;
    const oneIndex = states.findIndex((state) => state.conditions.includes("n === 1"));
    return states
      .filter((state) => state.conditions.includes("n >= 2"))
      .some((state) =>
        state.transitions.some((transition) => transition.targets.includes(oneIndex)),
      );
  };

  it.each([
    "HeldCompare",
    "HeldNamed",
    "HeldHandle",
    "HeldCallback",
    "HeldRef",
    "HeldState",
    "HeldForwarded",
  ])("lets %s run the callback from the first render", (name) => {
    expect(isOneReachedFromMany(name)).toBe(true);
  });

  it("still runs the latest callback through a handle that lists it", () => {
    expect(isOneReachedFromMany("FreshHandle")).toBe(false);
  });
});
