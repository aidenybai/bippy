import { describe, expect, it } from "vite-plus/test";
import { analyzeScriptDepth, summarizeDepth } from "../depth.js";
import { buildWorklist, diffWorklist } from "../worklist.js";
import { matchSurvivors, parseStrykerSurvivors } from "../mutation-survivors.js";
import type { CoverageSummary } from "../report.js";

const SOURCE = `function f(a, count) {
  if (a > 0 && count === 1) { x(); } else { y(); }
  return count < 10 ? p() : q();
}`;

const summaryFor = (source: string): CoverageSummary => {
  const script = analyzeScriptDepth(
    "app.js",
    source,
    [{ ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }],
    () => ({ file: "src/app.ts", line: 1 }),
  );
  return {
    lines: { pct: 0, covered: 0, total: 0 },
    branches: { pct: 0, covered: 0, total: 0 },
    functions: { pct: 0, covered: 0, total: 0 },
    files: [],
    depth: summarizeDepth([script!]),
  };
};

describe("diffWorklist", () => {
  const current = buildWorklist(summaryFor(SOURCE));

  it("reports nothing changed against itself", () => {
    const delta = diffWorklist(current, current);
    expect(delta.closed).toHaveLength(0);
    expect(delta.opened).toHaveLength(0);
    expect(delta.carried).toHaveLength(current.length);
  });

  it("counts a removed baseline item as closed and a new item as opened", () => {
    const previous = current.slice(1); // baseline was missing current[0]
    const withExtra = [{ ...current[0]!, id: "stale:only-in-baseline" }, ...previous];
    const delta = diffWorklist(withExtra, current);
    expect(delta.opened.map((i) => i.id)).toContain(current[0]!.id);
    expect(delta.closed.map((i) => i.id)).toContain("stale:only-in-baseline");
  });

  it("is stable: same source yields the same ids", () => {
    expect(buildWorklist(summaryFor(SOURCE)).map((i) => i.id)).toEqual(current.map((i) => i.id));
  });
});

describe("parseStrykerSurvivors", () => {
  const report = {
    files: {
      "src/app.ts": {
        mutants: [
          { status: "Survived", mutatorName: "EqualityOperator", location: { start: { line: 2 } } },
          { status: "Killed", location: { start: { line: 2 } } },
          { status: "NoCoverage", location: { start: { line: 3 } } },
        ],
      },
    },
  };

  it("extracts only Survived mutants with a line", () => {
    const survivors = parseStrykerSurvivors(report);
    expect(survivors).toEqual([{ file: "src/app.ts", line: 2, mutator: "EqualityOperator" }]);
  });

  it("returns [] for a malformed report", () => {
    expect(parseStrykerSurvivors(null)).toEqual([]);
    expect(parseStrykerSurvivors({})).toEqual([]);
    expect(parseStrykerSurvivors({ files: { x: {} } })).toEqual([]);
  });

  it("does not throw when a file's `mutants` is a non-array value", () => {
    // A partial or errored Stryker report can emit a non-array payload here.
    for (const mutants of [5, true, {}, "str", { 0: 1, length: 1 }]) {
      expect(parseStrykerSurvivors({ files: { "a.ts": { mutants } } })).toEqual([]);
    }
  });
});

describe("matchSurvivors", () => {
  it("matches survivors back to manifest targets by file+line", () => {
    const summary = summaryFor(SOURCE);
    const line = summary.depth!.mutations[0]!.line;
    const matched = matchSurvivors(summary, [{ file: "whatever/src/app.ts", line }]);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((m) => m.line === line)).toBe(true);
  });

  it("returns [] when nothing matches", () => {
    expect(matchSurvivors(summaryFor(SOURCE), [{ file: "src/app.ts", line: 99999 }])).toEqual([]);
  });

  it("skips malformed survivor entries instead of throwing", () => {
    const summary = summaryFor(SOURCE);
    // @ts-expect-error exercising out-of-contract input
    expect(matchSurvivors(summary, [null, { file: 5, line: 5 }, { line: 5 }])).toEqual([]);
  });
});
