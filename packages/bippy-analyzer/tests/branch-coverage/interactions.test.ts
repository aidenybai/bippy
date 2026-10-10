import { describe, expect, it } from "vite-plus/test";
import {
  buildModelFromPrepared,
  createInteractionAnalyzer,
  dedupeInteractionTargets,
} from "../../src/branch-coverage/interactions.js";
import { prepareScript } from "../../src/branch-coverage/cfg-shared.js";
import type { OffsetMapper, V8Function } from "../../src/branch-coverage/cfg-shared.js";
import type { InteractionTarget } from "../../src/branch-coverage/report.js";

const buildScriptInteractionModel = (
  script: string,
  source: string,
  mapOffset: OffsetMapper | null = null,
  pruneInfeasible = false,
) => {
  const prepared = prepareScript(script, source);
  if (!prepared) return null;
  return buildModelFromPrepared(prepared, script, source, mapOffset, pruneInfeasible);
};

// Two independent binary decisions in one function, each arm a distinct block so
// arm offsets never overlap. This is the canonical combinatorial case: depth
// sees them as parallel (both depth 0), interactions asks if all four
// (a, b) outcome combinations were ever exercised together.
const SOURCE = `function f(a, b) {
  if (a) { x(); } else { y(); }
  if (b) { p(); } else { q(); }
}`;

// V8 functions for a single simulated test: the whole script counts as executed
// (outer range), with zero-count inner ranges punched over the arms NOT taken on
// this run. makeCountAt returns the innermost range, so those offsets read 0.
const testWhere = (notTaken: number[]): V8Function[] => [
  {
    ranges: [
      { startOffset: 0, endOffset: SOURCE.length, count: 1 },
      ...notTaken.map((offset) => ({ startOffset: offset, endOffset: offset + 1, count: 0 })),
    ],
  },
];

describe("interaction coverage", () => {
  const model = buildScriptInteractionModel("f.ts", SOURCE);

  it("finds the two independent decisions as one candidate pair", () => {
    expect(model).not.toBeNull();
    const totalPairs = model!.functions.reduce((sum, fn) => sum + fn.candidatePairs.length, 0);
    expect(totalPairs).toBe(1);
  });

  // Arm offsets, by matching each decision's arm labels to its block offset.
  const decisions = model!.functions.flatMap((fn) => fn.decisions);
  const armOffset = (decisionIndex: number, label: string): number => {
    const arm = decisions[decisionIndex]!.arms.find((candidate) => candidate.label === label);
    if (!arm || arm.probe.offset === null)
      throw new Error(`no ${label} arm on decision ${decisionIndex}`);
    return arm.probe.offset;
  };
  const aTrue = armOffset(0, "true");
  const aFalse = armOffset(0, "false");
  const bTrue = armOffset(1, "true");
  const bFalse = armOffset(1, "false");

  it("reports 50% when only the diagonal combinations were observed", () => {
    const analyzer = createInteractionAnalyzer([model!]);
    // Test 1: a=true,  b=true  -> combo (true, true)
    analyzer.observeTest("f.ts", testWhere([aFalse, bFalse]));
    // Test 2: a=false, b=false -> combo (false, false)
    analyzer.observeTest("f.ts", testWhere([aTrue, bTrue]));

    const summary = analyzer.summarize();
    expect(summary).not.toBeNull();
    // Each decision was exercised both ways -> 4 feasible combos; 2 observed.
    expect(summary!.pairs.total).toBe(4);
    expect(summary!.pairs.covered).toBe(2);
    expect(summary!.pairs.pct).toBe(50);
    // The two missing combinations are the off-diagonal (true,false)/(false,true).
    expect(summary!.targets).toHaveLength(2);
    const missing = summary!.targets.map((target) => `${target.a.arm},${target.b.arm}`).sort();
    expect(missing).toEqual(["false,true", "true,false"]);
  });

  it("reports 100% once every combination has co-occurred", () => {
    const analyzer = createInteractionAnalyzer([model!]);
    analyzer.observeTest("f.ts", testWhere([aFalse, bFalse])); // true,true
    analyzer.observeTest("f.ts", testWhere([aFalse, bTrue])); // true,false
    analyzer.observeTest("f.ts", testWhere([aTrue, bFalse])); // false,true
    analyzer.observeTest("f.ts", testWhere([aTrue, bTrue])); // false,false

    const summary = analyzer.summarize();
    expect(summary!.pairs.total).toBe(4);
    expect(summary!.pairs.covered).toBe(4);
    expect(summary!.targets).toHaveLength(0);
  });

  it("prunes a provably-infeasible combination when pruning is enabled", () => {
    // Two independent decisions over the SAME value: `s` can't equal both 1 and
    // 2, so the (s===1 true × s===2 true) combination is impossible. Each
    // decision is still exercised both ways across the run, so without pruning
    // it would be surfaced as a phantom gap.
    const src = `function f(s) {
  if (s === 1) { a(); } else { b(); }
  if (s === 2) { c(); } else { d(); }
}`;
    const at = (text: string): number => src.indexOf(text);
    const punch = (notTaken: number[]): V8Function[] => [
      {
        ranges: [
          { startOffset: 0, endOffset: src.length, count: 1 },
          ...notTaken.map((offset) => ({ startOffset: offset, endOffset: offset + 1, count: 0 })),
        ],
      },
    ];
    // s=1 -> (s===1 true, s===2 false); s=3 -> (false, false); s=2 -> (false, true).
    const runs = [
      punch([at("b()"), at("c()")]),
      punch([at("a()"), at("c()")]),
      punch([at("a()"), at("d()")]),
    ];

    const observe = (model: ReturnType<typeof buildScriptInteractionModel>) => {
      const analyzer = createInteractionAnalyzer([model!]);
      for (const run of runs) analyzer.observeTest("f.ts", run);
      return analyzer.summarize();
    };

    // Off (default): both decisions fired both ways -> 4 combos, the impossible
    // one is the single uncovered "gap".
    const without = observe(buildScriptInteractionModel("f.ts", src));
    expect(without!.pairs.total).toBe(4);
    expect(without!.targets).toHaveLength(1);

    // On: the impossible combination leaves the denominator and the worklist.
    const withPruning = observe(buildScriptInteractionModel("f.ts", src, null, true));
    expect(withPruning!.pairs.total).toBe(3);
    expect(withPruning!.pairs.covered).toBe(3);
    expect(withPruning!.targets).toHaveLength(0);
  });

  it("omits a pair entirely when one decision was only taken one way", () => {
    const analyzer = createInteractionAnalyzer([model!]);
    // `a` is always true; it is never exercised both ways, so the pair has no
    // demonstrably-feasible combinations and drops out of the denominator.
    analyzer.observeTest("f.ts", testWhere([aFalse, bFalse])); // true,true
    analyzer.observeTest("f.ts", testWhere([aFalse, bTrue])); // true,false

    const summary = analyzer.summarize();
    expect(summary).toBeNull();
  });

  it("surfaces a decision whose arm fired at stress scale in one test", () => {
    const analyzer = createInteractionAnalyzer([model!]);
    analyzer.observeTest("f.ts", testWhere([aFalse, bFalse]));
    analyzer.observeTest("f.ts", testWhere([aTrue, bTrue]));
    analyzer.observeTest("f.ts", [
      {
        ranges: [
          { startOffset: 0, endOffset: SOURCE.length, count: 1 },
          { startOffset: aTrue, endOffset: aTrue + 1, count: 50_000 },
          { startOffset: aFalse, endOffset: aFalse + 1, count: 0 },
          { startOffset: bTrue, endOffset: bTrue + 1, count: 0 },
        ],
      },
    ]);

    const summary = analyzer.summarize();
    expect(summary!.hotDecisions).toHaveLength(1);
    expect(summary!.hotDecisions[0]!.hits).toBe(50_000);
    expect(summary!.hotDecisions[0]!.line).toBe(2);
  });

  it("reports no stress candidates when every decision stays below the threshold", () => {
    const analyzer = createInteractionAnalyzer([model!]);
    analyzer.observeTest("f.ts", testWhere([aFalse, bFalse]));
    analyzer.observeTest("f.ts", testWhere([aTrue, bTrue]));

    const summary = analyzer.summarize();
    expect(summary!.hotDecisions).toHaveLength(0);
  });
});

// Expression-level branches (ternary / && / || / ?? / optional chain) used to
// surface as opaque `@L## =A/=B`. They now label from the controlling operand
// the builder carries on the terminal, and use outcome-named arms.
describe("expression-level decision labels", () => {
  const EXPR_SOURCE = `function g() {
  const t = ternTest ? p() : q();
  const v = andLeft && rhs;
  const w = orLeft || rhs;
  const x = nullishLeft ?? rhs;
  const u = chainBase?.foo;
}`;
  const exprModel = buildScriptInteractionModel("g.ts", EXPR_SOURCE);
  const decisions = exprModel!.functions.flatMap((fn) => fn.decisions);
  const armsOfLabel = (label: string): string[] => {
    const match = decisions.find((decision) => decision.label === label);
    if (!match) throw new Error(`no decision labeled ${label}`);
    return match.arms.map((arm) => arm.label);
  };

  it("labels a ternary by its test, with true/false arms in order", () => {
    expect(armsOfLabel("ternTest")).toEqual(["true", "false"]);
  });

  it("labels && by its left operand (rhs evaluated when truthy)", () => {
    expect(armsOfLabel("andLeft")).toEqual(["truthy", "falsy"]);
  });

  it("labels || by its left operand (rhs evaluated when falsy)", () => {
    expect(armsOfLabel("orLeft")).toEqual(["falsy", "truthy"]);
  });

  it("labels ?? by its left operand (rhs evaluated when nullish)", () => {
    expect(armsOfLabel("nullishLeft")).toEqual(["nullish", "present"]);
  });

  it("labels an optional chain by its base (present continues, nullish short-circuits)", () => {
    expect(armsOfLabel("chainBase")).toEqual(["present", "nullish"]);
  });
});

describe("interaction target dedup (code-split bundles)", () => {
  const target = (
    script: string,
    a: InteractionTarget["a"],
    b: InteractionTarget["b"],
  ): InteractionTarget => ({ script, depth: 1, a, b });
  const arm = (
    file: string | undefined,
    line: number,
    armLabel: string,
  ): InteractionTarget["a"] => ({
    label: "cond",
    file,
    line,
    arm: armLabel,
  });

  it("collapses the same source gap appearing in two bundles", () => {
    const a = arm("src/core/index.tsx", 2337, "present");
    const b = arm("src/core/index.tsx", 2436, "true");
    const deduped = dedupeInteractionTargets([
      target("core-AAA.js", a, b),
      target("core-BBB.js", a, b),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.script).toBe("core-AAA.js");
  });

  it("treats endpoint order as symmetric (a×b == b×a)", () => {
    const a = arm("f.ts", 10, "true");
    const b = arm("f.ts", 20, "false");
    const deduped = dedupeInteractionTargets([target("x.js", a, b), target("y.js", b, a)]);
    expect(deduped).toHaveLength(1);
  });

  it("keeps unmapped gaps bundle-distinct (no source to collapse on)", () => {
    const a = arm(undefined, 4195, "true");
    const b = arm("src/core/index.tsx", 2436, "true");
    const deduped = dedupeInteractionTargets([
      target("core-AAA.js", a, b),
      target("core-BBB.js", a, b),
    ]);
    expect(deduped).toHaveLength(2);
  });

  it("keeps genuinely different source gaps", () => {
    const shared = arm("src/core/index.tsx", 2436, "true");
    const deduped = dedupeInteractionTargets([
      target("core-AAA.js", arm("src/core/index.tsx", 2337, "present"), shared),
      target("core-AAA.js", arm("src/core/index.tsx", 2390, "false"), shared),
    ]);
    expect(deduped).toHaveLength(2);
  });
});
