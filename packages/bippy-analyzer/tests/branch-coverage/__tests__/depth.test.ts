import { describe, expect, it } from "vite-plus/test";
import { analyzeScriptDepth, summarizeDepth } from "../depth.js";
import type { OffsetMapper, V8Function } from "../cfg-shared.js";

// `deepDep()` sits two decisions deep; `shallowOwn()` one. Both are left
// unreached so they compete to be the reported "deepest gap".
const SOURCE = `function f(a, b) {
  if (a) {
    if (b) {
      deepDep();
    }
  }
  if (a) {
    shallowOwn();
  }
}`;

const deepOffset = SOURCE.indexOf("deepDep");
const shallowOffset = SOURCE.indexOf("shallowOwn");

// Everything executes except the two target calls (zero-count ranges punched
// over them), so they are the only unreached deep blocks.
const v8Functions: V8Function[] = [
  {
    ranges: [
      { startOffset: 0, endOffset: SOURCE.length, count: 1 },
      { startOffset: deepOffset, endOffset: deepOffset + 1, count: 0 },
      { startOffset: shallowOffset, endOffset: shallowOffset + 1, count: 0 },
    ],
  },
];

const within = (offset: number, start: number, text: string): boolean =>
  offset >= start && offset < start + text.length;

describe("depth deepest-gap source preference", () => {
  it("prefers a shallower first-party gap over a deeper bundled-dependency gap", () => {
    const mapOffset: OffsetMapper = (offset) => {
      if (within(offset, deepOffset, "deepDep()"))
        return { file: "node_modules/dep/x.js", line: 1 };
      if (within(offset, shallowOffset, "shallowOwn()")) return { file: "src/a.ts", line: 2 };
      return null;
    };
    const depth = analyzeScriptDepth("f.ts", SOURCE, v8Functions, mapOffset);
    expect(depth).not.toBeNull();
    // The deeper gap is in node_modules, so the actionable hint is the
    // first-party one even though it is shallower.
    expect(depth!.deepestGap?.file).toBe("src/a.ts");
  });

  it("still reports the deepest gap when it is first-party", () => {
    const mapOffset: OffsetMapper = (offset) => {
      if (within(offset, deepOffset, "deepDep()")) return { file: "src/deep.ts", line: 1 };
      if (within(offset, shallowOffset, "shallowOwn()")) return { file: "src/a.ts", line: 2 };
      return null;
    };
    const depth = analyzeScriptDepth("f.ts", SOURCE, v8Functions, mapOffset);
    expect(depth!.deepestGap?.file).toBe("src/deep.ts");
    expect(depth!.deepestGap!.depth).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a dependency gap only when no first-party gap exists", () => {
    const mapOffset: OffsetMapper = () => ({ file: "node_modules/dep/x.js", line: 1 });
    const depth = analyzeScriptDepth("f.ts", SOURCE, v8Functions, mapOffset);
    expect(depth!.deepestGap?.file).toBe("node_modules/dep/x.js");
  });
});

describe("half-covered branch gaps", () => {
  const punch = (source: string, zeros: Array<[number, number]>): V8Function[] => [
    {
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        ...zeros.map(([startOffset, endOffset]) => ({ startOffset, endOffset, count: 0 })),
      ],
    },
  ];

  it("reports a reached decision whose arm never fired, with condition + untaken arm", () => {
    const src = `function f(a) {
  if (a) { hit(); } else { miss(); }
}`;
    const missAt = src.indexOf("miss");
    const depth = analyzeScriptDepth("f.ts", src, punch(src, [[missAt, missAt + 1]]));
    expect(depth!.branchGaps).toHaveLength(1);
    expect(depth!.branchGaps[0]).toMatchObject({ condition: "a", arm: "false" });
  });

  it("reports nothing when every arm fired", () => {
    const src = `function f(a) {
  if (a) { hit(); } else { alsoHit(); }
}`;
    const depth = analyzeScriptDepth("f.ts", src, punch(src, []));
    expect(depth!.branchGaps).toHaveLength(0);
  });

  it("ignores an unreached (dead) decision — that's a line-coverage gap, not a branch one", () => {
    const src = `function f(a, b) {
  if (a) {
    if (b) { x(); }
  }
}`;
    // Punch out the entire outer consequent: the inner `if (b)` and its body
    // never execute, so the inner decision is unreached.
    const innerAt = src.indexOf("if (b)");
    const depth = analyzeScriptDepth("f.ts", src, punch(src, [[innerAt, src.length]]));
    const conditions = depth!.branchGaps.map((gap) => gap.condition);
    // The outer `if (a)` is reached but its true arm never taken -> reported.
    expect(depth!.branchGaps).toContainEqual(
      expect.objectContaining({ condition: "a", arm: "true" }),
    );
    // The inner `if (b)` never ran, so it must NOT appear.
    expect(conditions).not.toContain("b");
  });

  it("does not charge a constant-false `if` then-arm against branch coverage", () => {
    const src = `function f() {
  if (false) { dead(); } else { live(); }
}`;
    const deadAt = src.indexOf("dead");
    // `dead()` never runs (it can't); `live()` does. Without dead-arm
    // suppression the impossible `true` arm would show as a half-covered gap.
    const depth = analyzeScriptDepth("f.ts", src, punch(src, [[deadAt, deadAt + 1]]));
    expect(depth!.branchEdges.total).toBe(1);
    expect(depth!.branchGaps).toHaveLength(0);
  });

  it("does not charge a `while (true)` exit arm against branch coverage", () => {
    const src = `function f() {
  while (true) { run(); }
}`;
    const depth = analyzeScriptDepth("f.ts", src, punch(src, []));
    // Only the loop-enter arm counts; the condition-exit arm can never be taken.
    expect(depth!.branchEdges.total).toBe(1);
    expect(depth!.branchGaps.map((gap) => gap.arm)).not.toContain("exit");
  });

  it("still counts both arms of a non-constant guard", () => {
    const src = `function f(a) {
  if (a) { hit(); } else { miss(); }
}`;
    const missAt = src.indexOf("miss");
    const depth = analyzeScriptDepth("f.ts", src, punch(src, [[missAt, missAt + 1]]));
    expect(depth!.branchEdges.total).toBe(2);
    expect(depth!.branchGaps).toHaveLength(1);
  });

  it("drops bundled-dependency gaps from the aggregated worklist", () => {
    const src = `function f(a) {
  if (a) { hit(); } else { miss(); }
}`;
    const missAt = src.indexOf("miss");
    const toNodeModules: OffsetMapper = () => ({ file: "node_modules/dep/x.js", line: 1 });
    const script = analyzeScriptDepth(
      "f.ts",
      src,
      punch(src, [[missAt, missAt + 1]]),
      toNodeModules,
    );
    // The per-script record still collected the gap...
    expect(script!.branchGaps).toHaveLength(1);
    // ...but the actionable worklist filters out the dependency.
    expect(summarizeDepth([script!]).branchGaps).toHaveLength(0);
  });
});

describe("dead-code and expression-branch handling", () => {
  const punch = (source: string, zeros: Array<[number, number]>): V8Function[] => [
    {
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        ...zeros.map(([startOffset, endOffset]) => ({ startOffset, endOffset, count: 0 })),
      ],
    },
  ];

  it("does not let a constant-dead block win the deepest-gap hint", () => {
    const src = `function f(a) {
  if (false) {
    if (a) { veryDeepDead(); }
  }
  if (a) { liveShallow(); }
}`;
    const deadAt = src.indexOf("veryDeepDead");
    const liveAt = src.indexOf("liveShallow");
    const depth = analyzeScriptDepth(
      "f.ts",
      src,
      punch(src, [
        [deadAt, deadAt + 1],
        [liveAt, liveAt + 1],
      ]),
    );
    // The deeper block sits behind `if (false)`, so it's dead code, not a gap.
    // The live-but-unreached shallow block is the actionable deepest gap.
    expect(depth!.deepestGap?.line).toBe(5);
  });

  it("does not count the dead arm of a constant ternary", () => {
    const src = `function f() {
  return true ? a() : b();
}`;
    const depth = analyzeScriptDepth("f.ts", src, punch(src, []));
    expect(depth!.branchEdges.total).toBe(1);
  });

  it("counts both arms of a non-constant ternary", () => {
    const src = `function f(c) {
  return c ? a() : b();
}`;
    const depth = analyzeScriptDepth("f.ts", src, punch(src, []));
    expect(depth!.branchEdges.total).toBe(2);
  });

  it("does not count the never-evaluated right operand of `false && x`", () => {
    const src = `function f(x) {
  return false && x();
}`;
    const depth = analyzeScriptDepth("f.ts", src, punch(src, []));
    expect(depth!.branchEdges.total).toBe(1);
  });

  it("measures a ternary arm by its own execution, not the borrowed merge hit", () => {
    // c=false path only: the inner `d ? p() : q()` never evaluates. Its two arms
    // must read uncovered (the old code borrowed the covered return/merge hit and
    // reported them all covered, hiding the gap).
    const src = `function f(c, d) {
  return c ? (d ? p() : q()) : r();
}`;
    const innerStart = src.indexOf("(d ?");
    const innerEnd = src.indexOf(") : r");
    const depth = analyzeScriptDepth("f.ts", src, [
      {
        ranges: [
          { startOffset: 0, endOffset: src.length, count: 1 },
          { startOffset: innerStart, endOffset: innerEnd, count: 0 },
        ],
      },
    ]);
    // Outer alternate `r()` covered; outer consequent (the inner group) and both
    // inner arms uncovered: 1 of 4.
    expect(depth!.branchEdges).toMatchObject({ covered: 1, total: 4 });
    expect(depth!.branchGaps.length).toBe(3);
  });

  it("flags the short-circuit arm of `a && b` when the left never went falsy", () => {
    // The whole expression always runs (count 1) and `b` always evaluates too
    // (count 1), so `a` was never falsy: the short-circuit arm never fired.
    const src = `function f(a, b) {
  return a && b();
}`;
    const bStart = src.indexOf("b()");
    const depth = analyzeScriptDepth("f.ts", src, [
      { ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] },
    ]);
    // Right-operand arm covered (b ran); short-circuit arm not (a never falsy).
    expect(depth!.branchEdges).toMatchObject({ covered: 1, total: 2 });
    expect(depth!.branchGaps.map((gap) => gap.arm)).toContain("falsy");
    void bStart;
  });

  it("measures guard depth inside an infinite loop (virtual exit)", () => {
    // `while (true)` blocks never reach the function exit, so a naive
    // post-dominator tree drops them and collapses depth to 0. The virtual-exit
    // tree keeps depth defined: the `if (cond)` inside is a real guard.
    const whileTrue = `function f(cond) {
  while (true) { if (cond) { deep(); } else { other(); } step(); }
}`;
    const depth = analyzeScriptDepth("f.ts", whileTrue, punch(whileTrue, []));
    expect(depth!.maxDepth).toBe(1);
    expect(depth!.deepBlocks.total).toBeGreaterThan(0);

    // `for (;;)` is the same case with no test node.
    const forever = `function f(cond) {
  for (;;) { if (cond) { deep(); } else { other(); } }
}`;
    expect(analyzeScriptDepth("f.ts", forever, punch(forever, []))!.maxDepth).toBe(1);

    // A conditionally-entered loop is unchanged: its body is genuinely guarded
    // by the loop test, so the nested `if` sits at depth 2.
    const whileX = `function f(cond, x) {
  while (x) { if (cond) { deep(); } else { other(); } step(); }
}`;
    expect(analyzeScriptDepth("f.ts", whileX, punch(whileX, []))!.maxDepth).toBe(2);
  });

  it("captures nested-ternary structure in maxDepth without over-claiming depthReached", () => {
    const src = `function f(c, d) {
  return c ? (d ? p() : q()) : r();
}`;
    // c=false path only: r() runs, the inner `d ? p() : q()` never evaluates.
    const innerStart = src.indexOf("(d ?");
    const innerEnd = src.indexOf(") : r");
    const depth = analyzeScriptDepth("f.ts", src, [
      {
        ranges: [
          { startOffset: 0, endOffset: src.length, count: 1 },
          { startOffset: innerStart, endOffset: innerEnd, count: 0 },
        ],
      },
    ]);
    // The nesting exists, so maxDepth sees depth 2...
    expect(depth!.maxDepth).toBe(2);
    // ...but no test reached the depth-2 arms, so depthReached must not claim 2
    // by borrowing the downstream merge's hit count.
    expect(depth!.depthReached).toBeLessThan(2);

    // When the deep arms genuinely run, depthReached honestly credits them.
    const fully = analyzeScriptDepth("f.ts", src, [
      { ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] },
    ]);
    expect(fully!.depthReached).toBe(2);
  });

  it("does not count a decision nested inside a constant-dead arm", () => {
    const src = `function f(x) {
  if (false) { if (x) { p(); } else { q(); } }
  g();
}`;
    const depth = analyzeScriptDepth("f.ts", src, punch(src, []));
    // The inner `if (x)` lives behind `if (false)`, so it can never run; its two
    // arms must not inflate branch edges. Only the outer guard's live arm counts.
    expect(depth!.branchEdges.total).toBe(1);
    expect(depth!.branchGaps).toHaveLength(0);
  });
});

describe("optional-chain and switch arm accuracy", () => {
  const punch = (source: string, zeros: Array<[number, number]>): V8Function[] => [
    {
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        ...zeros.map(([startOffset, endOffset]) => ({ startOffset, endOffset, count: 0 })),
      ],
    },
  ];

  it("reports the optional present arm uncovered when the base is always nullish", () => {
    const src = `function f(o) { return o?.profile; }`;
    const prof = src.indexOf("profile");
    // The `.profile` continuation never runs (base always nullish); the rest does.
    const depth = analyzeScriptDepth("f.ts", src, punch(src, [[prof, prof + 7]]));
    expect(depth!.branchEdges).toMatchObject({ covered: 1, total: 2 });
    expect(depth!.branchGaps.map((gap) => gap.arm)).toContain("present");
  });

  it("counts both optional arms covered when the base goes nullish and present", () => {
    const src = `function f(o) { return o?.profile; }`;
    const prof = src.indexOf("profile");
    // Base `o` evaluated 3 times (whole-fn range) but `.profile` only 2: the
    // surplus is one short-circuit, so the present arm (2 > 0) and the nullish
    // arm (base 3 > continuation 2) are both covered.
    const depth = analyzeScriptDepth("f.ts", src, [
      {
        ranges: [
          { startOffset: 0, endOffset: src.length, count: 3 },
          { startOffset: prof, endOffset: prof + 7, count: 2 },
        ],
      },
    ]);
    expect(depth!.branchEdges).toMatchObject({ covered: 2, total: 2 });
  });

  it("gives each switch case a distinct arm label so dedupe keeps them all", () => {
    const src = `function f(x) {
  switch (x) {
    case 1: a(); break;
    case 2: b(); break;
    case 3: c(); break;
    default: d();
  }
}`;
    const bAt = src.indexOf("b()");
    const cAt = src.indexOf("c()");
    const depth = analyzeScriptDepth(
      "f.ts",
      src,
      punch(src, [
        [bAt, bAt + 1],
        [cAt, cAt + 1],
      ]),
    );
    const arms = summarizeDepth([depth!]).branchGaps.map((gap) => gap.arm);
    // Two distinct uncovered cases must both survive the file:line:arm dedupe.
    expect(new Set(arms).size).toBe(arms.length);
    expect(arms.length).toBeGreaterThanOrEqual(2);
  });
});
