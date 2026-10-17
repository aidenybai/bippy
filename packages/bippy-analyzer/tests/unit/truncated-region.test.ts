import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

const FLAGS = ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"];

describe("a region with more states than are listed", () => {
  const project = analyzeFixture("conformance-repros", "truncated-region");
  const { report } = getComponent(project, "Workspace");
  const conditions = report.states.map((state) => state.conditions);

  it("caps the region at the limit and says so", () => {
    expect(report.isTruncated).toBe(true);
    expect(report.regions.map((region) => region.states.length)).toEqual([2, 256]);
  });

  it("lists the state the component first renders", () => {
    expect(conditions).toContainEqual(["!isPanelOpen"]);
    expect(conditions).toContainEqual(["isPanelOpen", ...FLAGS.map((flag) => `!flags.${flag}`)]);
  });

  it("lists both outcomes of every branch, nearest the first render first", () => {
    for (const flag of FLAGS) {
      expect(conditions.some((state) => state.includes(`flags.${flag}`))).toBe(true);
      expect(conditions.some((state) => state.includes(`!flags.${flag}`))).toBe(true);
    }
    const changedFlagCounts = conditions
      .filter((state) => state[0] === "isPanelOpen")
      .map((state) => state.filter((condition) => !condition.startsWith("!")).length - 1);
    expect(Math.max(...changedFlagCounts)).toBe(4);
  });
});
