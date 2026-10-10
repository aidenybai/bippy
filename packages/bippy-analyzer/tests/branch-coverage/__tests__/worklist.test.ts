import { describe, expect, it } from "vite-plus/test";
import { analyzeScriptDepth, summarizeDepth } from "../depth.js";
import { buildWorklist } from "../worklist.js";
import type { CoverageSummary } from "../report.js";
import type { V8Function } from "../cfg-shared.js";

// `escalate()` (depth 2) is never reached; the shallow guards are half-covered.
const SOURCE = `function classify(user, count) {
  if (user.role === "admin") {
    if (count > 100) {
      return escalate(count);
    }
    return "admin";
  }
  return count > 0 ? "active" : "idle";
}`;

const summaryFor = (source: string): CoverageSummary => {
  const ranges: V8Function[] = [
    {
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        // Zero the whole `return escalate(count);` so its block (and the
        // `count > 100` true arm leading to it) reads as genuinely unreached.
        {
          startOffset: source.indexOf("return escalate(count);"),
          endOffset: source.indexOf("return escalate(count);") + "return escalate(count);".length,
          count: 0,
        },
      ],
    },
  ];
  const script = analyzeScriptDepth("app.ts", source, ranges);
  const depth = summarizeDepth([script!]);
  return {
    lines: { pct: 0, covered: 0, total: 0 },
    branches: { pct: 0, covered: 0, total: 0 },
    functions: { pct: 0, covered: 0, total: 0 },
    files: [],
    depth,
  };
};

describe("unified worklist", () => {
  const worklist = buildWorklist(summaryFor(SOURCE));

  it("merges every signal into one ranked queue", () => {
    const kinds = new Set(worklist.map((item) => item.kind));
    expect(kinds.has("branch")).toBe(true);
    expect(kinds.has("edge")).toBe(true);
    expect(kinds.has("mutation")).toBe(true);
    expect(worklist.length).toBeGreaterThan(3);
  });

  it("ranks the deepest gap first", () => {
    expect(worklist[0]!.depth).toBe(Math.max(...worklist.map((item) => item.depth)));
    // The depth-2 escalate block is the deepest target.
    expect(worklist[0]!.priority).toBeGreaterThan(worklist[worklist.length - 1]!.priority);
  });

  it("is sorted by descending priority", () => {
    for (let i = 1; i < worklist.length; i++) {
      expect(worklist[i - 1]!.priority).toBeGreaterThanOrEqual(worklist[i]!.priority);
    }
  });

  it("gives every item a stable, unique id and a concrete action", () => {
    const ids = worklist.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(worklist.every((item) => item.action.length > 0)).toBe(true);
    // Re-deriving the worklist yields identical ids (stable across runs).
    expect(buildWorklist(summaryFor(SOURCE)).map((item) => item.id)).toEqual(ids);
  });

  it("returns an empty queue when no depth analysis ran", () => {
    expect(
      buildWorklist({
        lines: { pct: 0, covered: 0, total: 0 },
        branches: { pct: 0, covered: 0, total: 0 },
        functions: { pct: 0, covered: 0, total: 0 },
        files: [],
      }),
    ).toEqual([]);
  });
});
