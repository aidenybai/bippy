import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("calling a function a handler reaches indirectly", () => {
  const project = analyzeFixture("conformance-repros", "handler-call-forms");

  const getTargets = (name: string, from: string[], to: string[]) => {
    const { report } = getComponent(project, name);
    const findState = (conditions: string[]) =>
      report.states.findIndex((state) =>
        conditions.every((condition) => state.conditions.includes(condition)),
      );
    const source = report.states[findState(from)];
    const targets = source?.transitions.flatMap((transition) => transition.targets) ?? [];
    return { targets, target: findState(to) };
  };

  it.each([
    "CallStateMember",
    "ApplyRefMember",
    "BindMemoMember",
    "TimeoutRefMember",
    "MemoModuleFactory",
    "EveryOtherMemo",
    "ImportedFactory",
  ])("runs the setter in %s", (name) => {
    const { targets, target } = getTargets(name, ["n === 0"], ["n !== 0"]);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(targets).toContain(target);
  });

  it.each([
    "ActionsObject",
    "ConditionalForEach",
    "MemoTableKey",
    "ArrayAtIndex",
    "EntriesMemoTable",
    "IndexThenIndex",
  ])("runs the second function in %s", (name) => {
    const { targets, target } = getTargets(name, ["n === 0"], ["n !== 0", "n !== 1"]);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(targets).toContain(target);
  });

  it("runs a reducer dispatch passed as a callback", () => {
    const { targets, target } = getTargets("DispatchForEach", ["total === 0"], ["total !== 0"]);
    expect(target).toBeGreaterThanOrEqual(0);
    expect(targets).toContain(target);
  });

  it("stops some at the first callback that returns true", () => {
    const { report } = getComponent(project, "SomeShortCircuit");
    expect(report.states.map((state) => state.conditions)).toEqual([["n === 0"], ["n !== 0"]]);
    expect(report.states[0]?.transitions.flatMap((transition) => transition.targets)).toEqual([1]);
  });
});
