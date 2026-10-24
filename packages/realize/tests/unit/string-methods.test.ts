import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("pure string methods", () => {
  const project = analyzeFixture("conformance-repros", "string-methods");

  it("map over the receiver's reachable cases", () => {
    const { report } = getComponent(project, "TrimCases");
    expect(report.states).toHaveLength(1);
    expect(report.unreachableBranches).toHaveLength(1);
  });

  it("follow the receiver through its transitions", () => {
    const { report } = getComponent(project, "UpperMode");
    const first = report.states.findIndex((state) =>
      state.conditions.includes('mode.toUpperCase() === "A"'),
    );
    expect(report.regions[0]?.firstRenderState).toBe(first);
    expect(report.states[first]?.transitions.flatMap((transition) => transition.targets)).toEqual([
      report.states.findIndex((state) => state.conditions.includes('mode.toUpperCase() !== "A"')),
    ]);
  });

  it("fold on a literal", () => {
    const { report } = getComponent(project, "LiteralTrim");
    expect(report.states.map((state) => state.conditions)).toEqual([[]]);
  });

  it("stay open on a value without cases", () => {
    const { report } = getComponent(project, "OpenPrefix");
    expect(report.states).toHaveLength(2);
  });
});
