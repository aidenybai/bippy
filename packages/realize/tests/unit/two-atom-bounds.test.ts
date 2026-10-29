import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a comparison with two atoms on one side", () => {
  const project = analyzeFixture("conformance-repros", "two-atom-bounds");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("decides tests over two literal sets", () => {
    expect(getConditions("ToggledPair")).toEqual([[]]);
  });

  it("reads end - start as a difference bound", () => {
    expect(getConditions("RangeWindow")).toEqual([[]]);
  });
});
