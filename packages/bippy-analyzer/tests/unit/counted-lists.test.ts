import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a number tested both by comparison and by truthiness", () => {
  it("is truthy where its bounds rule out zero and falsy where they pin it there", () => {
    const { report } = getComponent(
      analyzeFixture("symbolic-tree", "counted-lists.tsx"),
      "CountedList",
    );
    expect(report.states.map((state) => state.conditions)).toEqual([
      ["items.length > 0"],
      ["items.length <= 0"],
      ["count > 0"],
      ["count <= 0", "!count"],
      ["count <= 0", "count"],
    ]);
  });
});
