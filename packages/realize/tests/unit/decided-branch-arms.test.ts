import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("decided branch arms", () => {
  const project = analyzeFixture("conformance-repros", "flagged-steps");

  it("records only the updates on the arm a known test takes", () => {
    const { analysis } = getComponent(project, "Stepper");
    expect(
      analysis.handlers.map((handler) => handler.updates.map((update) => update.binding.name)),
    ).toEqual([["count"], ["count", "log"]]);
  });
});
