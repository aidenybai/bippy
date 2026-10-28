import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a render value computed from state through an opaque step", () => {
  const project = analyzeFixture("conformance-repros", "render-hidden-inputs");

  it.each([
    "BoundLevel",
    "CountedLevel",
    "DatedLevel",
    "HolderLevel",
    "GetterLevel",
    "GetterSumLevel",
    "SetterLevel",
  ])("%s can change when the state changes", (name) => {
    const { report } = getComponent(project, name);
    expect(report.unreachableBranches).toEqual([]);
    expect(report.states.every((state) => state.transitions.length > 0)).toBe(true);
  });
});
