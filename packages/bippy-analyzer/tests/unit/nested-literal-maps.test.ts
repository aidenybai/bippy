import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("nested literal maps", () => {
  it("collects handlers on elements a literal map returns inside an opaque callback", () => {
    const project = analyzeFixture("conformance-repros", "nested-literal-maps");
    const updatedNames = getComponent(project, "AlignGrid").analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => update.binding.name),
    );
    expect(updatedNames).toContain("pick");
  });
});
