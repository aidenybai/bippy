import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("self comparisons", () => {
  const project = analyzeFixture("conformance-repros", "self-comparisons");

  const getReport = (name: string) => {
    const { report } = getComponent(project, name);
    return {
      conditions: report.states.map((state) => state.conditions),
      unreachable: report.unreachableBranches.map((branch) => branch.description),
    };
  };

  it("decides a prop compared with itself", () => {
    expect(getReport("SelfMode")).toEqual({
      conditions: [[]],
      unreachable: ["never mode !== mode"],
    });
  });

  it("decides a state field compared with itself", () => {
    expect(getReport("SelfField")).toEqual({
      conditions: [[]],
      unreachable: ["never state.mode !== state.mode"],
    });
  });

  it("leaves a number compared with itself open, since it may be NaN", () => {
    expect(getReport("SelfCount").conditions).toEqual([["count === count"], ["count !== count"]]);
  });
});
