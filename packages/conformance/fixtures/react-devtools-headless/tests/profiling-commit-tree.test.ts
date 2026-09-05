import { describe, expect, it } from "vite-plus/test";
import { createCommitTree } from "../src/profiling-commit-tree.js";

describe("upstream profiling commit-tree behavior", () => {
  it("should be able to rebuild the store tree for each commit", () => {
    const sizes = [1, 3, 2, 0].map(
      (count) =>
        createCommitTree(1, [
          { children: [2], id: 1, parentId: null },
          { children: Array.from({ length: count }, (_, index) => index + 3), id: 2, parentId: 1 },
          ...Array.from({ length: count }, (_, index) => ({
            children: [],
            id: index + 3,
            parentId: 2,
          })),
        ]).nodes.size,
    );
    expect(sizes).toEqual([3, 5, 4, 2]);
  });

  it("should support Lazy components", () => {
    const pending = createCommitTree(1, [
      { children: [2], id: 1, parentId: null },
      { children: [3], id: 2, parentId: 1 },
      { children: [], id: 3, parentId: 2 },
    ]);
    const resolved = createCommitTree(1, [
      ...pending.nodes.values(),
      { children: [], id: 4, parentId: 3 },
    ]);
    expect([pending.nodes.size, resolved.nodes.size]).toEqual([3, 4]);
  });

  it("should support Lazy components that are unmounted before resolving", () => {
    const pending = createCommitTree(1, [
      { children: [2], id: 1, parentId: null },
      { children: [3], id: 2, parentId: 1 },
      { children: [], id: 3, parentId: 2 },
    ]);
    const unmounted = createCommitTree(1, [...pending.nodes.values()].slice(0, 2));
    expect([pending.nodes.size, unmounted.nodes.size]).toEqual([3, 2]);
  });

  it("should handle transitioning from fallback back to content during profiling", () => {
    const content = createCommitTree(1, [
      { children: [2], id: 1, parentId: null },
      { children: [3], id: 2, parentId: 1 },
      { children: [], id: 3, parentId: 2 },
    ]);
    const fallback = createCommitTree(1, [
      { children: [2], id: 1, parentId: null },
      { children: [4], id: 2, parentId: 1 },
      { children: [], id: 4, parentId: 2 },
    ]);
    expect(content.nodes.has(3)).toBe(true);
    expect(fallback.nodes.has(4)).toBe(true);
  });
});
