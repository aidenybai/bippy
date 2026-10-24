import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("effects of one commit", () => {
  const project = analyzeFixture("conformance-repros", "commit-effects");

  it("read the commit's values together, so one doesn't see another's update", () => {
    const { analysis, report } = getComponent(project, "EffectsOfOneCommit");
    const effectIds = new Set(
      analysis.handlers
        .filter((handler) => handler.trigger.kind === "Effect")
        .map((handler) => handler.id),
    );
    const committed = report.states.find(
      (state) => state.conditions.join(" && ") === "!flag && count === 1",
    );
    const targets = (committed?.transitions ?? [])
      .filter((transition) => effectIds.has(transition.handlerId))
      .flatMap((transition) => transition.targets)
      .map((target) => report.states[target]?.conditions.join(" && "));
    expect(targets).toContain("flag && count !== 1");
  });
});
