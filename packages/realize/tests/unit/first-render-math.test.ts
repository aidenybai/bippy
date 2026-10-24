import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a first render that calls Math on known state", () => {
  const project = analyzeFixture("conformance-repros", "first-render-math");

  it.each([
    ["MaxStep", ["Math.max(step - 1, 0) === 0"]],
    ["HalfStep", ["Math.floor(step / 2) === 0"]],
  ])("%s starts from the computed value", (name, conditions) => {
    const { report } = getComponent(project, name);
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual(conditions);
  });

  it("folds Number over the cases of a union state", () => {
    const { report } = getComponent(project, "ParsedChoice");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["Number(raw) > 1"],
      ["Number(raw) <= 1"],
    ]);
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never Number(raw) > 2",
    ]);
  });

  it("carries the cases of a parsed union into the state it sets", () => {
    const { report } = getComponent(project, "ParsedUnion");
    expect(report.unreachableBranches.map((branch) => branch.description)).toEqual([
      "never count === 2",
    ]);
  });

  it("checks a literal list for a known state", () => {
    const { report } = getComponent(project, "ListedStep");
    const firstState = report.regions[0]?.firstRenderState ?? null;
    expect(firstState === null ? null : report.states[firstState]?.conditions).toEqual([
      "[1, 2].includes(step)",
    ]);
  });
});
