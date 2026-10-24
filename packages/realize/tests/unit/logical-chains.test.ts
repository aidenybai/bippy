import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("printing an || or && chain", () => {
  const { report } = getComponent(
    analyzeFixture("symbolic-tree", "logical-chains.tsx"),
    "FeatureBadge",
  );
  const conditions = new Set(report.states.flatMap((state) => state.conditions));

  it("prints each operand once, as the source wrote it", () => {
    expect(conditions).toContain('isEnabled("search") || isEnabled("sync") || isEnabled("share")');
    expect(conditions).toContain('isEnabled("sync") && isEnabled("offline")');
  });
});
