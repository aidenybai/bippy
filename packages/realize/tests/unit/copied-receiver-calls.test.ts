import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a call on a copy of state", () => {
  const project = analyzeFixture("conformance-repros", "copied-receiver-calls");
  const getItemsTargets = (name: string) => {
    const { analysis, report } = getComponent(project, name);
    const itemHandlerIds = new Set(
      analysis.handlers
        .filter((handler) => handler.updates.some((update) => update.binding.name === "items"))
        .map((handler) => handler.id),
    );
    return report.states.flatMap((state, index) =>
      state.transitions
        .filter((transition) => itemHandlerIds.has(transition.handlerId))
        .flatMap((transition) => transition.targets.filter((target) => target !== index)),
    );
  };

  it("follows the state a spread copy is sorted from", () => {
    expect(getItemsTargets("SpreadSortFlag")).not.toEqual([]);
  });

  it("follows the state a spread copy is filtered from", () => {
    expect(getItemsTargets("SpreadFilterFlag")).not.toEqual([]);
  });

  it("follows the state a concat copy is filtered from", () => {
    expect(getItemsTargets("ConcatFilterFlag")).not.toEqual([]);
  });

  it("follows the state behind an unknown receiver", () => {
    expect(getItemsTargets("ConcatSomeFlag")).not.toEqual([]);
  });
});
