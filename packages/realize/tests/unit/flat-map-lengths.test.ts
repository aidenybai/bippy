import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("setting state to a flatMap of itself", () => {
  const project = analyzeFixture("conformance-repros", "flat-map-lengths");

  it.each([
    ["DroppedRows", "items.length !== 1", "items.length === 1"],
    ["DoubledRows", "items.length !== 2", "items.length === 2"],
  ])("lets %s change the length", (name, fromCondition, toCondition) => {
    const { states } = getComponent(project, name).report;
    const fromState = states.find((state) => state.conditions.includes(fromCondition));
    const toIndex = states.findIndex((state) => state.conditions.includes(toCondition));
    expect(fromState?.transitions.flatMap((transition) => transition.targets)).toContain(toIndex);
  });
});
