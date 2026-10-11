import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project.js";
import { getComponent, getFixtureConfig } from "./helpers.js";

describe("effect paths", () => {
  const project = analyzeProject(getFixtureConfig("conformance-repros"), "effect-return-paths");

  it("leads to every value an effect sets on separate paths", () => {
    const notice = getComponent(project, "ExternalNotice");
    const effectIds = new Set(
      notice.analysis.handlers
        .filter((handler) => handler.trigger.kind === "Effect")
        .map((handler) => handler.id),
    );
    const shownIndex = notice.report.states.findIndex((state) =>
      state.conditions.includes("isExternal"),
    );
    const hidden = notice.report.states.find((state) => state.conditions.includes("!isExternal"));
    const effectTargets = hidden?.transitions
      .filter((transition) => effectIds.has(transition.handlerId))
      .flatMap((transition) => transition.targets);
    expect(effectTargets).toContain(shownIndex);
  });
});
