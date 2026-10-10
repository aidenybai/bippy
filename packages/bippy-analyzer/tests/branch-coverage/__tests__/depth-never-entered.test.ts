import { describe, expect, it } from "vite-plus/test";
import { analyzeScriptDepth } from "../depth.js";
import type { V8Function } from "../cfg-shared.js";

// `entered()` is called but its depth-2 `reachedDeep()` never runs. `neverRun()`
// is never called at all, so its *deeper* depth-3 `unreachableDeep()` block is
// unreached too. Before the never-entered guard, the deeper block won the
// "deepest gap" and produced a misleading "reach this depth-3 block" target — a
// block that cannot run until the function is called at all. The honest gap is
// the entered function's reachable frontier; the never-entered function should
// only be surfaced at its entry (depth 1), so it can never outrank a genuinely
// deeper gap in code a test actually entered.
const SRC = `function entered(a, b) {
  if (a) {
    if (b) {
      reachedDeep();
    }
  }
}
function neverRun(c, d) {
  if (c) {
    if (d) {
      if (c && d) {
        unreachableDeep();
      }
    }
  }
}`;

const punch = (source: string, zeros: Array<[number, number]>): V8Function[] => [
  {
    ranges: [
      { startOffset: 0, endOffset: source.length, count: 1 },
      ...zeros.map(([startOffset, endOffset]) => ({ startOffset, endOffset, count: 0 })),
    ],
  },
];

const neverRunStart = SRC.indexOf("function neverRun");
const reachedDeepOffset = SRC.indexOf("reachedDeep");

describe("depth never-entered function handling", () => {
  it("does not let a never-entered function's deeper interior block win the deepest gap", () => {
    const depth = analyzeScriptDepth(
      "f.ts",
      SRC,
      // never enter neverRun() (zero over its whole body) and miss reachedDeep()
      // inside the entered function.
      punch(SRC, [
        [neverRunStart, SRC.length],
        [reachedDeepOffset, reachedDeepOffset + 1],
      ]),
    );

    expect(depth).not.toBeNull();
    const gapLine = SRC.split("\n")[depth!.deepestGap!.line - 1] ?? "";
    // the entered function's depth-2 gap wins, not neverRun()'s depth-3 block
    expect(gapLine).toContain("reachedDeep");
    expect(gapLine).not.toContain("unreachableDeep");
    expect(depth!.deepestGap!.depth).toBe(2);
  });

  it("still surfaces a fully never-entered script at its entry (recall preserved)", () => {
    // neverRun() is the only function exercised at all here, and it is never
    // entered; the gap must fall back to its entry rather than vanish.
    const onlyNeverRun = SRC.slice(neverRunStart);
    const depth = analyzeScriptDepth(
      "f.ts",
      onlyNeverRun,
      punch(onlyNeverRun, [[0, onlyNeverRun.length]]),
    );
    expect(depth).not.toBeNull();
    expect(depth!.deepestGap).toBeDefined();
    expect(depth!.deepestGap!.depth).toBe(1);
  });
});
