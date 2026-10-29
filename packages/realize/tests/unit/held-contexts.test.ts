import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a consumer that holds an earlier context callback", () => {
  const project = analyzeFixture("conformance-repros", "held-contexts");

  const isOneReachedFromMany = (name: string): boolean => {
    const { states } = getComponent(project, name).report;
    const oneIndex = states.findIndex((state) => state.conditions.includes("n === 1"));
    return states
      .filter((state) => state.conditions.includes("n >= 2"))
      .some((state) =>
        state.transitions.some((transition) => transition.targets.includes(oneIndex)),
      );
  };

  it.each(["HeldRefContext", "HeldCallbackContext", "HeldStateContext"])(
    "lets %s run the callback from the first render",
    (name) => {
      expect(isOneReachedFromMany(name)).toBe(true);
    },
  );

  it("still runs the latest callback for a consumer that reads it each render", () => {
    expect(isOneReachedFromMany("LatestContext")).toBe(false);
  });

  it("does not treat spread props as held when a child holds only a context value", () => {
    expect(isOneReachedFromMany("SpreadToContextHolder")).toBe(false);
  });
});
