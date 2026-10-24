import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("annotated declarations", () => {
  const project = analyzeFixture("conformance-repros", "annotated-hooks");

  it("types a hook result stored in a variable with a type annotation", () => {
    const { analysis } = getComponent(project, "ThemeBadge");
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.bindings.map((binding) => [binding.name, binding.domain.kind])).toEqual([
      ["theme", "Cases"],
      ["notify", "Opaque"],
    ]);
  });
});
