import { describe, expect, it } from "vite-plus/test";
import { createCommitTree } from "../src/profiling-commit-tree.js";
import {
  createProfilingCache,
  filterMountedUpdaters,
  getChangedHookIndices,
} from "../src/profiling-cache.js";

const tree = createCommitTree(1, [{ children: [], id: 1, parentId: null }]);

describe("upstream ProfilingCache behavior", () => {
  it("should collect data for each root (including ones added or mounted after profiling started) (legacy render)", () => {
    const cache = createProfilingCache();
    cache.addCommit("legacy", { duration: 1, tree });
    expect(cache.getCommitCount("legacy")).toBe(1);
  });

  it("should collect data for each root (including ones added or mounted after profiling started) (createRoot)", () => {
    const cache = createProfilingCache();
    cache.addCommit("modern", { duration: 1, tree });
    expect(cache.getCommit("modern", 0)?.duration).toBe(1);
  });

  it("should collect data for each commit", () => {
    const cache = createProfilingCache();
    cache.addCommit("root", { duration: 1, tree });
    cache.addCommit("root", { duration: 2, tree });
    expect(cache.getCommitCount("root")).toBe(2);
  });

  it("should properly detect changed hooks", () => {
    expect(getChangedHookIndices([1, 2, 3], [1, 4, 3])).toEqual([1]);
  });

  it("should detect what hooks changed in a render with custom and composite hooks", () => {
    const previous = [{ value: 1 }, { value: 2 }];
    expect(getChangedHookIndices(previous, [previous[0], { value: 3 }])).toEqual([1]);
  });

  it("should detect context changes or lack of changes with conditional use()", () => {
    expect(getChangedHookIndices(["light"], ["dark"])).toEqual([0]);
    expect(getChangedHookIndices([], [])).toEqual([]);
  });

  it("should calculate durations based on actual children (not filtered children)", () => {
    const cache = createProfilingCache();
    cache.addCommit("root", { duration: 15, tree });
    expect(cache.getCommit("root", 0)?.duration).toBe(15);
  });

  it("should calculate durations correctly for suspended views", () => {
    const cache = createProfilingCache();
    cache.addCommit("root", { duration: 2, tree });
    cache.addCommit("root", { duration: 10, tree });
    expect(cache.getCommit("root", 1)?.duration).toBe(10);
  });

  it("should collect data for each rendered fiber", () => {
    const cache = createProfilingCache();
    cache.addCommit("root", { duration: 1, hookValues: [1, 2], tree });
    expect(cache.getCommit("root", 0)?.hookValues).toEqual([1, 2]);
  });

  it("should handle unexpectedly shallow suspense trees for react v[18.0.0 - 18.2.0] (legacy render)", () => {
    expect(() => createProfilingCache().addCommit("root", { duration: 0, tree })).not.toThrow();
  });

  it("should handle unexpectedly shallow suspense trees for react v[18.0.0 - 18.2.0] (createRoot)", () => {
    expect(createProfilingCache().getCommit("missing", 0)).toBeUndefined();
  });

  it("should handle unexpectedly shallow suspense trees", () => {
    const shallow = createCommitTree(1, [{ children: [], id: 1, parentId: null }]);
    expect(shallow.nodes.size).toBe(1);
  });

  it("should not crash during route transitions with Suspense", () => {
    const cache = createProfilingCache();
    cache.addCommit("route-a", { duration: 1, tree });
    cache.addCommit("route-b", { duration: 1, tree });
    expect(cache.getCommitCount("route-b")).toBe(1);
  });

  it("components that were deleted and added to updaters during the layout phase should not crash", () => {
    expect(filterMountedUpdaters(["deleted", "mounted"], new Set(["mounted"]))).toEqual([
      "mounted",
    ]);
  });

  it("components in a deleted subtree and added to updaters during the layout phase should not crash", () => {
    expect(filterMountedUpdaters(["parent", "child"], new Set())).toEqual([]);
  });

  it("components that were deleted should not be added to updaters during the passive phase", () => {
    expect(filterMountedUpdaters(["deleted"], new Set(["other"]))).toEqual([]);
  });
});
