import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("handlers on a disabled form element", () => {
  const project = analyzeFixture("conformance-repros", "disabled-handlers");

  const getTransitionsFrom = (name: string, condition: string) => {
    const { report } = getComponent(project, name);
    const state = report.states.find((candidate) => candidate.conditions.includes(condition));
    return state?.transitions.map((transition) => transition.handlerId) ?? [];
  };

  it("never fire while the element stays disabled", () => {
    expect(getTransitionsFrom("LockedButton", "!isDone")).toEqual([]);
  });

  it("still fire for mouse leave, which React only blocks for clicks and mouse enter", () => {
    expect(getTransitionsFrom("LockedButtonLeave", "!isLeft")).toHaveLength(1);
  });

  it("fire once the element can be enabled", () => {
    expect(getTransitionsFrom("UnlockedButton", "!isDone")).toHaveLength(1);
  });
});
