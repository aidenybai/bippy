import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("local updates", () => {
  const project = analyzeFixture("conformance-repros", "local-updates");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("keeps the value a postfix update in a branch gives a local", () => {
    expect(getConditions("PostfixLocal")).toEqual([
      ["(isExtra ? 2 : 1) > 1"],
      ["(isExtra ? 2 : 1) <= 1"],
    ]);
  });

  it("keeps the values prefix and postfix updates in both arms give a local", () => {
    expect(getConditions("PrefixBothArms")).toEqual([
      ["(isExtra ? 2 : 0) > 1"],
      ["(isExtra ? 2 : 0) <= 1"],
    ]);
  });

  it("gives a postfix update expression the value before the update", () => {
    expect(getConditions("ChainedIndices")[0]).toEqual([
      "(hasTabs ? 0 : -1) >= 0",
      "(hasChats ? hasTabs ? 1 : 0 : -1) > 0",
    ]);
  });
});
