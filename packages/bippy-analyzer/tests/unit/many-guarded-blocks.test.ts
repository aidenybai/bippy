import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler with many guarded blocks", () => {
  it("builds its update sequences up to the cap without enumerating every path first", () => {
    const project = analyzeFixture("conformance-repros", "many-guarded-blocks");
    const { analysis, report } = getComponent(project, "ManyGuardedBlocks");
    const effect = analysis.handlers.find((handler) => handler.trigger.kind === "Effect");
    expect(effect?.updates.length).toBeGreaterThan(1000);
    expect(report.states.length).toBeGreaterThan(0);
    expect(report.isTruncated).toBe(true);
  });
});
