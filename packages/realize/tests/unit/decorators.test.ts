import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("decorators", () => {
  it("analyzes a file whose classes use decorators", () => {
    const project = analyzeFixture("conformance-repros", "decorated-model");
    expect(getComponent(project, "PolicyToggle").analysis.bailouts).toEqual([]);
  });
});
