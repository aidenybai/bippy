import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("key checks on object literals", () => {
  const project = analyzeFixture("conformance-repros", "key-checks");

  const getDecidedOutcomes = (name: string, testSource: string): boolean[] | undefined => {
    const { analysis } = getComponent(project, name);
    const start = readFileSync(analysis.file, "utf8").indexOf(testSource);
    const branchKeyPrefix = `${analysis.file}:${start}:${start + testSource.length}:`;
    return [...analysis.decidedBranchOutcomes].find(([branchKey]) =>
      branchKey.startsWith(branchKeyPrefix),
    )?.[1];
  };

  it("decides whether each object literal passed in has the key", () => {
    expect(getDecidedOutcomes("SizeForm", '"width" in updates')).toEqual([false, true]);
  });

  it("decides a listed key, and leaves a key the prototype has undecided", () => {
    expect(getDecidedOutcomes("EntryLabel", '"label" in entry')).toEqual([true]);
    expect(getDecidedOutcomes("EntryLabel", '"toString" in entry')).toBeUndefined();
  });
});
