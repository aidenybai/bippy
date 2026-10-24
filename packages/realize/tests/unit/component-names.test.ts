import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture } from "./helpers";

describe("component names", () => {
  const project = analyzeFixture("conformance-repros", "wrapped-components");

  it("names components wrapped in forwardRef and memo after their variable", () => {
    expect(project.components.map((component) => component.analysis.name).sort()).toEqual([
      "Badge",
      "Button",
      "Pill",
    ]);
  });
});
