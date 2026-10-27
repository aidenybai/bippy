import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("rows of a map over a literal array", () => {
  const project = analyzeFixture("conformance-repros", "literal-row-toggles");
  const { report } = getComponent(project, "FaqAccordion");

  it("give each row its own region", () => {
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["openSections.shipping"],
      ["!openSections.shipping"],
      ["openSections.returns"],
      ["!openSections.returns"],
      ["openSections.warranty"],
      ["!openSections.warranty"],
    ]);
  });

  it("flip only the row whose button was clicked", () => {
    expect(
      report.states.map((state) => state.transitions.map((transition) => transition.targets)),
    ).toEqual([
      [[1], [0], [0]],
      [[0], [1], [1]],
      [[2], [3], [2]],
      [[3], [2], [3]],
      [[4], [4], [5]],
      [[5], [5], [4]],
    ]);
  });
});
