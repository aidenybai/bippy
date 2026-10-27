import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a render test that reads a whole literal state", () => {
  const project = analyzeFixture("conformance-repros", "whole-value-tests");

  it.each([
    ["HasOwnFlags", 'Object.hasOwn(flags, "b")'],
    ["KeysLength", "Object.keys(flags).length !== 0"],
    ["ReduceSum", "items.reduce(function, 0) > 2"],
  ])("decides the first render of %s from the initial value", (name, condition) => {
    const { report } = getComponent(project, name);
    const [firstRender, ...others] = report.regions[0]?.possibleFirstRenderStates ?? [];
    expect(others).toEqual([]);
    expect(report.states[firstRender ?? -1]?.conditions).toEqual([condition]);
  });
});
