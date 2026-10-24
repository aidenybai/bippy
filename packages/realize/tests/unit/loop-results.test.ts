import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("loop results", () => {
  const project = analyzeFixture("conformance-repros", "loop-results");

  const getConditions = (name: string) =>
    getComponent(project, name).report.states.map((state) => state.conditions);

  it("folds a loop's iteration checks into one opaque test", () => {
    expect(getConditions("LoopMemo")).toEqual([
      ["Unknown(loop)", "messages[i].text"],
      ["Unknown(loop)", "!messages[i].text"],
      ["!Unknown(loop)"],
    ]);
  });

  it("keeps two loops apart", () => {
    expect(getConditions("TwoLoopMemos")).toHaveLength(9);
  });

  it("keeps a test on a prop inside the loop", () => {
    expect(getConditions("LoopWithStateTest").map((conditions) => conditions[1])).toEqual([
      "showAll",
      "showAll",
      "!showAll",
      "!showAll",
      "!showAll",
      undefined,
    ]);
  });
});
