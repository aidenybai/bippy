import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("constants typed as a single literal", () => {
  const project = analyzeFixture("symbolic-tree", "literal-constants.tsx");

  it("compare as that literal, so a switch over them covers the union", () => {
    const { report } = getComponent(project, "SizeLabel");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['size === "sm"'],
      ['size !== "sm"'],
    ]);
  });

  it("include enum members and a default that holds one", () => {
    const { report } = getComponent(project, "ToneLabel");
    const [loud, calm] = report.states.map((state) => state.conditions.join(" "));
    expect(report.states).toHaveLength(2);
    expect(loud).toMatch(/\? "calm" : .*=== "loud"/);
    expect(calm).toMatch(/\? "calm" : .*!== "loud"/);
  });
});
