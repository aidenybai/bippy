import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("this bound by bind, call, apply and setters", () => {
  const project = analyzeFixture("conformance-repros", "this-bindings");

  it.each([
    "BoundElsewhere",
    "CalledOn",
    "AppliedOn",
    "SetterThis",
    "ChosenBoundArguments",
    "ChosenBoundReceivers",
    "SetterAfterMethodCall",
  ])("lets a click in %s set 2", (name) => {
    const { states } = getComponent(project, name).report;
    const twoIndex = states.findIndex((state) => state.conditions.includes("n === 2"));
    expect(
      states.some((state) =>
        state.transitions.some((transition) => transition.targets.includes(twoIndex)),
      ),
    ).toBe(true);
  });
});
