import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("arithmetic in a next value", () => {
  it("adds no opaque variable for an update the model computes", async () => {
    const { model } = getComponent(await analyzeFixture("state-charts"), "ToneCounter");
    expect(model.variables.map((variable) => [variable.label, variable.source])).toEqual([
      ["tone", "input"],
      ["count", "state"],
    ]);
    expect(model.stateSpace.stateCount).toBe(6);
  });
});
