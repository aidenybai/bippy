import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a literal passed to a call that may mutate it", () => {
  const project = analyzeFixture("conformance-repros", "possibly-mutated-literals");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("is no longer read as the literal after the call", () => {
    expect(getConditions("ConfiguredLabel")).toEqual([["Unknown(member)"], ["!Unknown(member)"]]);
    expect(getConditions("PropMutation")).toEqual([
      ["Unknown(member) > 0"],
      ["Unknown(member) <= 0"],
    ]);
  });

  it("is still a hook result after a method call in a handler", () => {
    const targets = getComponent(project, "HookResultMethod").report.states.map((state) =>
      state.transitions.map((transition) => transition.targets),
    );
    expect(targets).toEqual([
      [[1], [0]],
      [[1], [0]],
    ]);
  });

  it("is still the literal after a read-only method", () => {
    expect(getConditions("ReadOnlyMethod")).toEqual([
      ['items.includes("a")'],
      ['!items.includes("a")'],
    ]);
  });
});
