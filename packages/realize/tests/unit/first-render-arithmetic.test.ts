import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a first render that does arithmetic on known state", () => {
  const project = analyzeFixture("conformance-repros", "first-render-arithmetic");

  it.each([
    ["Remainder", ["count % 2 === 1"]],
    ["Doubled", ["count * 2 === 2"]],
  ])("%s folds the arithmetic to pick its first state", (name, conditions) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual(conditions);
  });
});
