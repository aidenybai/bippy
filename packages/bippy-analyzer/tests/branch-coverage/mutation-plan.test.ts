import { describe, expect, it } from "vite-plus/test";
import { analyzeScriptDepth, summarizeDepth } from "../../src/branch-coverage/depth.js";
import { buildMutationPlan } from "../../src/branch-coverage/mutation-plan.js";
import type { CoverageSummary } from "../../src/branch-coverage/report.js";
import type { V8Function } from "../../src/branch-coverage/cfg-shared.js";

const summaryFor = (source: string, mapped: boolean): CoverageSummary => {
  const ranges: V8Function[] = [
    { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
  ];
  // Map every offset to src/app.ts:<servedLine> when `mapped`, else leave unmapped.
  const script = analyzeScriptDepth(
    "app.js",
    source,
    ranges,
    mapped ? () => ({ file: "src/app.ts", line: 1 }) : null,
  );
  return {
    lines: { pct: 0, covered: 0, total: 0 },
    branches: { pct: 0, covered: 0, total: 0 },
    functions: { pct: 0, covered: 0, total: 0 },
    files: [],
    depth: summarizeDepth([script!]),
  };
};

describe("buildMutationPlan", () => {
  const source = `function f(a, b) {
  if (a > 10 && b === 1) { x(); } else { y(); }
  return a < 0 ? p() : q();
}`;

  it("derives mutators from the condition kinds present", () => {
    const plan = buildMutationPlan(summaryFor(source, true));
    expect(plan.mutators).toContain("EqualityOperator"); // > and ===
    expect(plan.mutators).toContain("LogicalOperator"); // &&
  });

  it("scopes `mutate` to source lines and stays sorted/unique", () => {
    const plan = buildMutationPlan(summaryFor(source, true));
    expect(plan.mutate.length).toBeGreaterThan(0);
    expect(plan.mutate.every((entry) => entry.startsWith("src/app.ts:"))).toBe(true);
    expect([...plan.mutate]).toEqual([...new Set(plan.mutate)].sort());
  });

  it("emits no mutate lines for unmapped (bundle-coordinate) decisions", () => {
    const plan = buildMutationPlan(summaryFor(source, false));
    expect(plan.mutate).toHaveLength(0);
    // ...but the targets are still listed (a mutation tester can't run them yet).
    expect(plan.targets.length).toBeGreaterThan(0);
  });

  it("returns empty arrays when no depth analysis ran", () => {
    const plan = buildMutationPlan({
      lines: { pct: 0, covered: 0, total: 0 },
      branches: { pct: 0, covered: 0, total: 0 },
      functions: { pct: 0, covered: 0, total: 0 },
      files: [],
    });
    expect(plan).toEqual({ mutate: [], mutators: [], targets: [] });
  });
});
