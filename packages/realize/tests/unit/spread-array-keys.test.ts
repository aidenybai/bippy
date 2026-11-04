import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a non-canonical key on an array with spreads", async () => {
  const project = await analyzeFixture("conformance-repros", "spread-array-keys");

  it("does not read an element", () => {
    const updates = getComponent(project, "PaddedSpreadKey").analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => formatSymbolicValue(update.value)),
    );
    expect(updates).toHaveLength(1);
    expect(updates.join()).not.toContain("spread-index");
  });
});
