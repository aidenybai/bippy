import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture } from "./helpers";

describe("a class component", () => {
  const project = analyzeFixture("conformance-repros", "class-components");

  it("is reported with a bailout instead of being skipped", () => {
    const bailouts = project.components
      .filter((component) => component.analysis.file.endsWith("class-components.tsx"))
      .map((component) => [
        component.analysis.name,
        component.analysis.bailouts.map((bailout) => bailout.reason),
      ]);
    expect(bailouts).toEqual([
      ["ClassCounter", ["class-component"]],
      ["ClassBadge", ["class-component"]],
      ["ClassPanel", ["class-component"]],
    ]);
  });
});
