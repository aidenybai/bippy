import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a value a for-of loop leaves through break", () => {
  const project = analyzeFixture("conformance-repros", "for-of-break");

  it("is the item the break tested", () => {
    const { states } = getComponent(project, "ForOfBreakValue").report;
    const yes = states.findIndex((state) => state.conditions.includes("flag"));
    expect(states[yes]?.transitions.flatMap((transition) => transition.targets)).toEqual([yes]);
  });
});
