import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("two calls of the same custom hook", () => {
  const project = analyzeFixture("conformance-repros", "hook-call-bindings");

  const getStateNames = (name: string) =>
    getComponent(project, name)
      .analysis.bindings.filter((binding) => binding.kind === "state")
      .map((binding) => binding.name);

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("get their own state bindings", () => {
    expect(getStateNames("TwoInstances")).toEqual(["value", "value#2"]);
    expect(getConditions("TwoInstances")).toEqual([
      ["value && !value#2"],
      ["!(value && !value#2)"],
    ]);
  });

  it("keep their own initial values", () => {
    expect(getConditions("DifferentInitials")).toEqual([[], ["value"], ["!value"]]);
    expect(getComponent(project, "DifferentInitials").report.unreachableBranches).toHaveLength(1);
  });

  it("also split a tuple-returning hook", () => {
    expect(getStateNames("TwoTuples")).toEqual(["value", "value#2"]);
  });
});
