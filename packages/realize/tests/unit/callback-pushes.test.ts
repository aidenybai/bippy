import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a push inside a callback that can run many times", () => {
  const project = analyzeFixture("conformance-repros", "callback-pushes");

  it("doesn't take one handler push per item as one push", () => {
    const { states } = getComponent(project, "ForEachPush").report;
    const pair = states.findIndex((state) => state.conditions.includes("items.length === 2"));
    expect(states[pair]?.transitions.flatMap((transition) => transition.targets)).toContain(pair);
  });

  it("doesn't take one render push per item as one push", () => {
    const { states } = getComponent(project, "ForEachPushInRender").report;
    expect(states).toHaveLength(2);
  });
});
