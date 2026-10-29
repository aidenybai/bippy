import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("hooks whose settled value is their argument", () => {
  const project = analyzeFixture("conformance-repros", "passthrough-hooks");
  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const state = states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.flatMap((transition) =>
      transition.targets.map((target) => states[target]?.conditions),
    );
  };

  it("follows the value passed to useOptimistic", () => {
    expect(getTargets("OptimisticFollowsValue", "!flag")).toEqual([["flag"]]);
  });

  it("follows the value passed to useDeferredValue", () => {
    expect(getTargets("DeferredFollowsValue", "count !== 2")).toContainEqual(["count === 2"]);
  });

  it("runs a useEffectEvent callback with the render's values", () => {
    expect(getTargets("EffectEventReadsLatest", "!isOn")).toContainEqual(["isOn"]);
  });
});
