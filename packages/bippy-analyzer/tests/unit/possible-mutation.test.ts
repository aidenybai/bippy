import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/analyze-project";
import { getComponent, getFixtureConfig, getWarningKinds } from "./helpers";

describe("possible mutation", () => {
  const project = analyzeProject(getFixtureConfig("symbolic-tree"), "possible-mutation");
  const component = getComponent(project, "Deck");

  it("forgets state a handler passes to a function that may mutate it", () => {
    const [handler] = component.analysis.handlers;
    expect(handler?.updates.map((update) => update.binding.name)).toEqual(["count", "cards"]);
    const [nonEmpty, empty] = component.report.states.toReversed();
    expect(nonEmpty?.transitions[0]?.targets).toContain(0);
    expect(empty?.transitions[0]?.targets).toContain(1);
  });

  it("doesn't warn about a mutation that may not happen", () => {
    expect(getWarningKinds(component)).toEqual([]);
  });
});
