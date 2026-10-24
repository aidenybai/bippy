import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("an offset between two numbers", () => {
  const project = analyzeFixture("conformance-repros", "infinite-bounds");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("decides nothing when either side can be Infinity", () => {
    expect(getConditions("InfiniteGap")).toEqual([
      ["total >= used + 1", "total > used"],
      ["total >= used + 1", "total <= used"],
      ["total < used + 1"],
    ]);
  });

  it("still decides the comparison it implies for finite numbers", () => {
    expect(getConditions("FiniteGap")).toEqual([["total >= used + 1"], ["total < used + 1"]]);
  });
});
