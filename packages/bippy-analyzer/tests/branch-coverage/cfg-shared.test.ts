import { describe, expect, it } from "vite-plus/test";
import { makeCountAt } from "../../src/branch-coverage/cfg-shared.js";
import type { V8Function, V8Range } from "../../src/branch-coverage/cfg-shared.js";
import { createLineIndex, lineColOf } from "../../src/branch-coverage/utils/line-index.js";

// Deterministic PRNG (mulberry32) so the fuzz cases are reproducible.
const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Reference: the pre-optimization linear scan — innermost (smallest) covering
// range wins.
const naiveCountAt = (ranges: V8Range[], offset: number): number => {
  let innermost: V8Range | null = null;
  for (const range of ranges) {
    if (offset < range.startOffset || offset >= range.endOffset) continue;
    const size = range.endOffset - range.startOffset;
    if (innermost === null || size < innermost.endOffset - innermost.startOffset) innermost = range;
  }
  return innermost ? innermost.count : 0;
};

// Build a properly-nested forest of V8 ranges (children strictly inside parents,
// siblings disjoint) — the invariant V8 precise coverage guarantees.
const buildForest = (random: () => number): V8Range[] => {
  const ranges: V8Range[] = [];
  const add = (start: number, end: number, depth: number): void => {
    ranges.push({ startOffset: start, endOffset: end, count: Math.floor(random() * 5) });
    if (depth <= 0 || end - start < 4) return;
    let cursor = start + 1;
    const childCount = Math.floor(random() * 3);
    for (let child = 0; child < childCount; child++) {
      const remaining = end - 1 - cursor;
      if (remaining < 2) break;
      const childStart = cursor + Math.floor(random() * remaining);
      const maxLen = end - 1 - childStart;
      if (maxLen < 1) break;
      const childEnd = childStart + 1 + Math.floor(random() * maxLen);
      add(childStart, childEnd, depth - 1);
      cursor = childEnd + 1;
    }
  };
  add(0, 40 + Math.floor(random() * 60), 4);
  return ranges;
};

describe("makeCountAt", () => {
  it("returns 0 with no ranges", () => {
    const countAt = makeCountAt([]);
    expect(countAt(0)).toBe(0);
    expect(countAt(100)).toBe(0);
  });

  it("respects half-open [start, end) bounds and inner-overrides-outer", () => {
    const functions: V8Function[] = [
      { ranges: [{ startOffset: 10, endOffset: 20, count: 3 }] },
      { ranges: [{ startOffset: 13, endOffset: 16, count: 0 }] },
    ];
    const countAt = makeCountAt(functions);
    expect(countAt(9)).toBe(0);
    expect(countAt(10)).toBe(3);
    expect(countAt(12)).toBe(3);
    expect(countAt(13)).toBe(0); // inner range starts here
    expect(countAt(15)).toBe(0);
    expect(countAt(16)).toBe(3); // inner range ended (exclusive)
    expect(countAt(19)).toBe(3);
    expect(countAt(20)).toBe(0); // outer range ended (exclusive)
  });

  it("matches the naive scan across fuzzed nested forests", () => {
    for (let seed = 1; seed <= 250; seed++) {
      const random = seeded(seed);
      const ranges = buildForest(random);
      const maxEnd = Math.max(...ranges.map((range) => range.endOffset));
      const countAt = makeCountAt([{ ranges }]);
      for (let offset = -2; offset <= maxEnd + 2; offset++) {
        expect(countAt(offset)).toBe(naiveCountAt(ranges, offset));
      }
    }
  });
});

describe("createLineIndex", () => {
  it("matches the linear scan across fuzzed sources", () => {
    const alphabet = "ab\n cd\n\ne";
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed);
      const length = Math.floor(random() * 80);
      let source = "";
      for (let index = 0; index < length; index++) {
        source += alphabet[Math.floor(random() * alphabet.length)];
      }
      const index = createLineIndex(source);
      for (let offset = 0; offset <= source.length + 2; offset++) {
        const expected = lineColOf(source, offset);
        expect(index.lineColOf(offset)).toEqual(expected);
        expect(index.lineOf(offset)).toBe(expected.line);
      }
    }
  });
});
