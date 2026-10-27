import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a number state set to another number state", () => {
  const project = analyzeFixture("conformance-repros", "state-copy-bounds");

  it.each(["CopyOnClick", "CopyInEffect"])(
    "keeps the bounds that mention the copy in %s",
    (name) => {
      const { report } = getComponent(project, name);
      expect(report.states.map((state) => state.conditions)).toEqual([
        ["x - y === 0"],
        ["x - y !== 0", "x - y >= 1"],
        ["x - y !== 0", "x - y < 1"],
      ]);
    },
  );
});
