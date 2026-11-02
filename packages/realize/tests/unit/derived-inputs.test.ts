import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("derived inputs", () => {
  it("lets a derived value change when state it reads through a call changes", () => {
    const { model } = getComponent(
      analyzeFixture("conformance-repros", "render-hidden-inputs"),
      "CountedLevel",
    );
    const cycle = model.actions.find((action) => action.label === '"cycle"');
    expect(cycle?.writes.map((write) => write.variable)).toEqual([
      "step",
      "toLevel_countTo_step_length",
    ]);
  });
});
