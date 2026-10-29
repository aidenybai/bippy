import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("assuming a condition on a string", () => {
  const project = analyzeFixture("symbolic-tree", "narrowed-strings.tsx");

  it("decides the same string's truthiness again", () => {
    const { report } = getComponent(project, "HintField");
    expect(report.states.map((state) => state.conditions)).toEqual([["!hint"], ["hint"]]);
  });

  it("rules out a second literal once the string equals the first", () => {
    const { report } = getComponent(project, "ToneBadge");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['tone === "info"'],
      ['tone !== "info"', 'tone === "warning"'],
      ['tone !== "info"', 'tone !== "warning"'],
    ]);
  });
});
