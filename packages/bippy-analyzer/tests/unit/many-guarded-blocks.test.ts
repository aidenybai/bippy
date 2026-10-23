import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler with many guarded blocks", () => {
  const project = analyzeFixture("conformance-repros", "many-guarded-blocks");
  const { analysis, report } = getComponent(project, "ManyGuardedBlocks");

  it("builds its update sequences without enumerating every path first", () => {
    const effect = analysis.handlers.find((handler) => handler.trigger.kind === "Effect");
    expect(effect?.updates.length).toBeGreaterThan(1000);
  });

  it("widens the guards past the cap instead of truncating the region", () => {
    expect(report.isTruncated).toBe(false);
    expect(
      report.states.map((state) => state.transitions.flatMap((transition) => transition.targets)),
    ).toEqual([
      [0, 1, 2, 3],
      [0, 1, 2, 3],
      [0, 1, 2],
      [0, 1, 2, 3],
    ]);
  });
});
