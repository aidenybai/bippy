import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("loop updaters", () => {
  it("lets an updater in a loop run any number of times", () => {
    const { model } = getComponent(
      analyzeFixture("conformance-repros", "loop-updaters"),
      "LoopUpdatersOnly",
    );
    const [initialView] = model.stateSpace.initialViews;
    expect(
      model.stateSpace.edges.some(
        (edge) => edge.from === initialView && edge.to === 'button > "two"' && !edge.isInput,
      ),
    ).toBe(true);
  });
});
