import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("annotated declarations", async () => {
  const project = await analyzeFixture("conformance-repros", "annotated-hooks");

  it("types a hook result stored in a variable with a type annotation", () => {
    const { analysis } = getComponent(project, "ThemeBadge");
    expect(analysis.bailouts).toEqual([]);
    expect(analysis.bindings.map((binding) => [binding.name, binding.domain])).toEqual([
      [
        "theme",
        {
          kind: "Cases",
          cases: [
            { kind: "Literal", value: "dark" },
            { kind: "Literal", value: "light" },
          ],
          origin: "type",
        },
      ],
      [
        "notify",
        {
          kind: "Cases",
          cases: [{ kind: "Type", text: "Notify", primitive: null, isArrayLike: false }],
          origin: "type",
        },
      ],
    ]);
  });
});
