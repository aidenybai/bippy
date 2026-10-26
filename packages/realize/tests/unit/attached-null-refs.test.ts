import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a ref typed as null that is attached in JSX", () => {
  const project = analyzeFixture("conformance-repros", "attached-null-refs");

  const getTargets = (name: string, condition: string) => {
    const { states } = getComponent(project, name).report;
    const stateIndex = states.findIndex((state) => state.conditions.includes(condition));
    return {
      stateIndex,
      targets: states[stateIndex]?.transitions.flatMap((transition) => transition.targets) ?? [],
      states,
    };
  };

  it("lets an effect that checks the ref reach the closed state", () => {
    const { targets, states } = getTargets("ClosingPanel", "isShown");
    const closedIndex = states.findIndex((state) => state.conditions.includes("!isShown"));
    expect(targets).toContain(closedIndex);
  });

  it("lets an effect see a ref passed to a child", () => {
    const { targets, states } = getTargets("FocusedField", "!isFocused");
    const focusedIndex = states.findIndex((state) => state.conditions.includes("isFocused"));
    expect(targets).toContain(focusedIndex);
  });

  it("keeps null for a ref that is never attached", () => {
    const { states } = getComponent(project, "DetachedPanel").report;
    const transitionCount = states.flatMap((state, stateIndex) =>
      state.transitions.flatMap((transition) =>
        transition.targets.filter((target) => target !== stateIndex),
      ),
    ).length;
    expect(transitionCount).toBe(0);
  });
});
