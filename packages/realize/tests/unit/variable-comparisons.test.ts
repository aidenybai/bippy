import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("variable comparisons", () => {
  it("compiles a comparison of two states over both their values", async () => {
    const { model } = getComponent(
      await analyzeFixture("conformance-repros", "render-phase-updates"),
      "CopiedDuringRender",
    );
    expect(model.variables.map((variable) => [variable.label, variable.source])).toEqual([
      ["copy", "state"],
      ["source", "state"],
    ]);
  });
});
