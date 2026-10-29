import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a mount-only effect that reads a ref", () => {
  const project = analyzeFixture("conformance-repros", "mount-effect-refs");

  const getTransitionCount = (name: string) =>
    getComponent(project, name).report.states.flatMap((state, stateIndex) =>
      state.transitions.flatMap((transition) =>
        transition.targets.filter((target) => target !== stateIndex),
      ),
    ).length;

  it.each(["MeasuredBox", "PortalHost", "CallbackRefNode"])(
    "sees %s's ref after commit attached it",
    (name) => {
      expect(getComponent(project, name).report.states).toHaveLength(2);
      expect(getTransitionCount(name)).toBeGreaterThan(0);
    },
  );

  it("keeps the initial of a ref that is never attached", () => {
    expect(getTransitionCount("UnattachedRef")).toBe(0);
  });
});
