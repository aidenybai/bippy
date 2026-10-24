import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("an effect's cleanup", () => {
  const project = analyzeFixture("conformance-repros", "effect-cleanups");

  const getEffectUpdates = (name: string) =>
    getComponent(project, name)
      .analysis.handlers.filter((handler) => handler.trigger.kind === "Effect")
      .flatMap((handler) =>
        handler.updates.map(
          (update) => `${update.binding.name} = ${formatSymbolicValue(update.value)}`,
        ),
      );

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("runs when the effect's deps can change", () => {
    expect(getEffectUpdates("CleanupOnDeps")).toEqual(['mode = "c"']);
    expect(getConditions("CleanupOnDeps")).toEqual([['mode === "c"'], ['mode !== "c"']]);
  });

  it("runs before the body runs again", () => {
    expect(getEffectUpdates("BodyThenCleanup")).toEqual(['mode = "c"', 'mode = "b"']);
    const { report } = getComponent(project, "BodyThenCleanup");
    const bodyState = report.states.findIndex((state) => state.conditions[0] === 'mode === "b"');
    expect(report.states.flatMap((state) => state.transitions.map((t) => t.targets))).toEqual([
      [bodyState],
      [bodyState],
      [bodyState],
    ]);
  });

  it("does not run for an effect with empty deps", () => {
    expect(getEffectUpdates("MountOnly")).toEqual([]);
    expect(getConditions("MountOnly")).toEqual([[]]);
  });

  const getEffectTargets = (name: string, from: string[]) => {
    const { analysis, report } = getComponent(project, name);
    const effectIds = new Set(
      analysis.handlers
        .filter((handler) => handler.trigger.kind === "Effect")
        .map((handler) => handler.id),
    );
    const source = report.states.find(
      (state) => state.conditions.join(" && ") === from.join(" && "),
    );
    return (source?.transitions ?? [])
      .filter((transition) => effectIds.has(transition.handlerId))
      .flatMap((transition) => transition.targets)
      .map((target) => report.states[target]?.conditions.join(" && "));
  };

  it("reads the values of the render that returned it", () => {
    expect(getEffectTargets("CleanupReadsPreviousRender", ["!flag", "count !== 1"])).toContain(
      "!flag && count === 1",
    );
  });

  it("runs when an earlier render returned it, though this render returns none", () => {
    expect(getEffectTargets("CleanupFromEarlierRender", ["!flag", "count !== 1"])).toContain(
      "!flag && count === 1",
    );
  });
});
