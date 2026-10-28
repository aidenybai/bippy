import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("setting state to a map of an array whose length changed", () => {
  const project = analyzeFixture("conformance-repros", "mutated-map-lengths");

  it.each(["PushThenMap", "SpliceThenMap", "PendingPushThenMap", "MountClosureMap"])(
    "lets %s reach the other length",
    (name) => {
      const { states } = getComponent(project, name).report;
      const fromState = states.find((state) => state.conditions.includes("items.length !== 2"));
      const toIndex = states.findIndex((state) => state.conditions.includes("items.length === 2"));
      expect(fromState?.transitions.flatMap((transition) => transition.targets)).toContain(toIndex);
    },
  );
});
