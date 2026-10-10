import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { compareProject } from "./compare.js";
import type { DifferenceCategory, FunctionComparison } from "./compare.js";

interface KnownDifference {
  file: string;
  name: string;
  categories: DifferenceCategory[];
  changedLinePattern: RegExp;
  reason: string;
}

const CONFIG_PATH = fileURLToPath(
  new URL("../../fixtures/symbolic-tree/tsconfig.json", import.meta.url),
);

/**
 * Differences the compared npm build cannot avoid. Each must still occur, so a fix
 * upstream or in the port shows up as a failure here instead of a stale entry.
 */
const KNOWN_DIFFERENCES: KnownDifference[] = [
  {
    file: "src/todo.tsx",
    name: "TodoApp",
    categories: ["type"],
    changedLinePattern: /Date/,
    reason:
      "Version gap: facebook/react ff8f88fcd, after the npm build, typed the `Date` global as a function with a static `now`. The build still types it `Object<Date>`.",
  },
];

const getChangedLines = (patch: string): string[] =>
  patch
    .split("\n")
    .filter((line) => /^[-+]/.test(line) && !line.startsWith("---") && !line.startsWith("+++"));

const findKnownDifference = (comparison: FunctionComparison): KnownDifference | undefined =>
  KNOWN_DIFFERENCES.find(
    (knownDifference) =>
      comparison.file.endsWith(knownDifference.file) && comparison.name === knownDifference.name,
  );

describe("compiler port matches babel-plugin-react-compiler on fixtures/symbolic-tree", () => {
  let comparisons: FunctionComparison[] = [];

  beforeAll(() => {
    comparisons = compareProject(CONFIG_PATH, { fileFilter: null, isTypeProviderEnabled: false });
  });

  it("compares every component and hook", () => {
    expect(comparisons.length).toBeGreaterThan(0);
    expect(
      comparisons.filter(
        (comparison) => comparison.status !== "match" && comparison.status !== "mismatch",
      ),
    ).toEqual([]);
  });

  it("prints the same HIR after InferReactivePlaces", () => {
    const unexpected = comparisons.filter(
      (comparison) => comparison.status !== "match" && !findKnownDifference(comparison),
    );
    expect(
      unexpected.map(
        (comparison) => `${comparison.name}\n${comparison.patch ?? comparison.status}`,
      ),
    ).toEqual([]);
  });

  it.each(KNOWN_DIFFERENCES)("differs only as documented in $name", (knownDifference) => {
    const comparison = comparisons.find(
      (candidate) => findKnownDifference(candidate) === knownDifference,
    );
    expect(comparison?.status).toBe("mismatch");
    expect(comparison?.categories).toEqual(knownDifference.categories);
    expect(
      getChangedLines(comparison?.patch ?? "").filter(
        (line) => !knownDifference.changedLinePattern.test(line),
      ),
    ).toEqual([]);
  });
});
