import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("defaults and case tests the compiler can't reorder", () => {
  const project = analyzeFixture("symbolic-tree", "expression-defaults.tsx");

  it("lower a default that reads a local or is an element", () => {
    const { analysis, report } = getComponent(project, "Dialog");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["!isOpen"],
      ["isOpen", "icon === undefined"],
      ["isOpen", "icon !== undefined"],
    ]);
  });

  it("lower a switch on a prop's members", () => {
    const { analysis, report } = getComponent(project, "SizeLabel");
    expect(analysis.bailouts).toEqual([]);
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["size === sizes.small"],
      ["size !== sizes.small", "size === sizes.large"],
      ["size !== sizes.small", "size !== sizes.large"],
    ]);
  });
});
