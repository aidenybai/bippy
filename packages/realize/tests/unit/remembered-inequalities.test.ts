import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("remembered inequalities", () => {
  const project = analyzeFixture("conformance-repros", "remembered-inequalities");

  it("decides an equality from the inequality assumed before it", () => {
    const { report } = getComponent(project, "LayoutBadge");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['layout !== "legacy"'],
      ['layout === "legacy"'],
      ["isOpen"],
      ["!isOpen"],
    ]);
  });

  it("decides an inequality from the equality assumed before it", () => {
    const { report } = getComponent(project, "StatusBadge");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['status === "active"'],
      ['status !== "active"'],
    ]);
  });
});
