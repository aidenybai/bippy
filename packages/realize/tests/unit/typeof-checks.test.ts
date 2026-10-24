import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("typeof checks", () => {
  const project = analyzeFixture("symbolic-tree", "typeof-checks.tsx");

  it("narrows a union to the members typeof allows", () => {
    const { report } = getComponent(project, "PriceTag");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['typeof price === "string"'],
      ['typeof price !== "string"', 'typeof price === "number"'],
      ['typeof price !== "string"', 'typeof price !== "number"'],
    ]);
  });

  it("keeps both sides when an object type may be a function", () => {
    const { report } = getComponent(project, "Slot");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['typeof render === "function"'],
      ['typeof render !== "function"'],
    ]);
  });
});
