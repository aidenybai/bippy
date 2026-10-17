import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("async handler states", () => {
  it("predicts the state a handler leaves before its async updates land", () => {
    const project = analyzeFixture("conformance-repros", "handler-with-conditional-child");
    const { report } = getComponent(project, "SubmitButton");
    const loadingStateIndex = report.states.findIndex((state) =>
      state.conditions.includes("isLoading"),
    );
    const idleState = report.states.find((state) => state.conditions.includes("!isLoading"));
    const idleTargets = idleState?.transitions.flatMap((transition) => transition.targets) ?? [];
    expect(idleTargets).toContain(loadingStateIndex);
  });

  it("predicts the state between one async update and a later one", () => {
    const project = analyzeFixture("conformance-repros", "copy-button");
    const { report } = getComponent(project, "CopyButton");
    const copiedStateIndex = report.states.findIndex((state) =>
      state.conditions.includes("isCopied"),
    );
    const idleState = report.states.find((state) => state.conditions.includes("!isCopied"));
    const idleTargets = idleState?.transitions.flatMap((transition) => transition.targets) ?? [];
    expect(idleTargets).toContain(copiedStateIndex);
  });
});
