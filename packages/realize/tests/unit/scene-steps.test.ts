import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("lookups into a literal table", () => {
  const project = analyzeFixture("conformance-repros", "scene-steps");

  it("runs the function each entry of a table indexed by state holds", () => {
    const { analysis } = getComponent(project, "Walkthrough");
    const updates = analysis.handlers.flatMap((handler) =>
      handler.updates
        .filter((update) => update.binding.name === "isHighlighted")
        .map((update) => formatSymbolicValue(update.value)),
    );
    expect(updates).toEqual(["true", "false"]);
  });
});
