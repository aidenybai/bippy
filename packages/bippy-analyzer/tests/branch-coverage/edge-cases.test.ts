import { describe, expect, it } from "vite-plus/test";
import { analyzeScriptDepth, summarizeDepth } from "../../src/branch-coverage/depth.js";
import type { V8Function } from "../../src/branch-coverage/cfg-shared.js";

const reached = (source: string): V8Function[] => [
  { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
];
const edgesOf = (source: string) => {
  const script = analyzeScriptDepth("f.ts", source, reached(source));
  return summarizeDepth([script!]).edgeCases;
};

describe("edge-case worklist", () => {
  it("derives a boundary from each relational comparison against a constant", () => {
    const edges = edgesOf(`function f(n) { if (n > 10) { a(); } else { b(); } }`);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ kind: "boundary" });
    expect(edges[0]!.hint).toContain("10");
    expect(edges[0]!.hint).toContain("`n`");
  });

  it("captures both operands of a compound `&&` condition", () => {
    const edges = edgesOf(`function f(n) { if (n > 10 && n < 100) { a(); } }`);
    const values = edges.filter((e) => e.kind === "boundary").map((e) => e.hint);
    expect(values.some((h) => h.includes("10"))).toBe(true);
    expect(values.some((h) => h.includes("100"))).toBe(true);
  });

  it("normalizes a constant-on-the-left comparison by flipping the operator", () => {
    const edges = edgesOf(`function f(n) { if (10 < n) { a(); } }`);
    expect(edges[0]!.hint).toContain("`n`");
    expect(edges[0]!.hint).toContain("(>)");
  });

  it("emits a nullish edge for an optional chain and for `??`", () => {
    const edges = edgesOf(`function f(u) { return u?.name ?? "anon"; }`);
    expect(edges.filter((e) => e.kind === "nullish").length).toBeGreaterThanOrEqual(1);
    expect(edges.some((e) => e.hint.includes("null/undefined"))).toBe(true);
  });

  it("does not suggest edges for an unreached decision", () => {
    const src = `function f(n) { if (n > 10) { a(); } }`;
    // Punch the whole function body to count 0: nothing reached.
    const script = analyzeScriptDepth("f.ts", src, [{ ranges: [] }]);
    expect(summarizeDepth(script ? [script] : []).edgeCases).toHaveLength(0);
  });

  it("does not suggest boundaries for a constant-vs-constant comparison", () => {
    const edges = edgesOf(`function f() { if (1 < 2) { a(); } else { b(); } }`);
    expect(edges.filter((e) => e.kind === "boundary")).toHaveLength(0);
  });
});

describe("mutation manifest", () => {
  const mutationsOf = (source: string) => {
    const script = analyzeScriptDepth("f.ts", source, [
      { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
    ]);
    return summarizeDepth([script!]).mutations;
  };

  it("emits the boundary mutant for a relational operator", () => {
    const muts = mutationsOf(`function f(n) { if (n > 10) { a(); } else { b(); } }`);
    expect(muts).toContainEqual(
      expect.objectContaining({ kind: "relational", original: ">", mutated: ">=" }),
    );
  });

  it("emits negation for equality and a swap for logical operators", () => {
    const muts = mutationsOf(`function f(a, b) { if (a === 1 && b) { x(); } else { y(); } }`);
    expect(
      muts.some((m) => m.kind === "equality" && m.original === "===" && m.mutated === "!=="),
    ).toBe(true);
    expect(
      muts.some((m) => m.kind === "logical" && m.original === "&&" && m.mutated === "||"),
    ).toBe(true);
  });

  it("flags whether the decision was covered both ways", () => {
    const src = `function f(n) { if (n > 10) { hit(); } else { miss(); } }`;
    const missAt = src.indexOf("miss");
    // `miss()` never runs -> the decision only went one way.
    const oneWay = analyzeScriptDepth("f.ts", src, [
      {
        ranges: [
          { startOffset: 0, endOffset: src.length, count: 1 },
          { startOffset: missAt, endOffset: missAt + 1, count: 0 },
        ],
      },
    ]);
    const m = summarizeDepth([oneWay!]).mutations.find((x) => x.original === ">");
    expect(m!.bothArmsCovered).toBe(false);
  });

  it("emits no mutants for an unreached decision", () => {
    const src = `function f(n) { if (n > 10) { a(); } }`;
    const unreached = analyzeScriptDepth("f.ts", src, [{ ranges: [] }]);
    expect(summarizeDepth(unreached ? [unreached] : []).mutations).toHaveLength(0);
  });
});
