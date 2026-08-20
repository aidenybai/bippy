import { describe, expect, it } from "vite-plus/test";
import { createProfilerStore } from "../src/profiler-store.js";
import type { ProfilerStoreRootData } from "../src/profiler-store.js";

const rootData: ProfilerStoreRootData = {
  commits: [{ duration: 1, renderedUids: ["component"] }],
  rootUid: "root",
};

describe("upstream ProfilerStore behavior", () => {
  it("should not remove profiling data when roots are unmounted", () => {
    const store = createProfilerStore();
    store.setData([rootData]);
    store.removeRoot("root");
    expect(store.getData("root")).toEqual(rootData);
  });

  it("should not allow new/saved profiling data to be set while profiling is in progress", () => {
    const store = createProfilerStore();
    store.startProfiling();
    expect(() => store.setData([rootData])).toThrow("while profiling");
  });

  it("should filter empty commits", () => {
    const store = createProfilerStore();
    store.setData([
      {
        commits: [
          { duration: 0, renderedUids: [] },
          { duration: 1, renderedUids: ["component"] },
        ],
        rootUid: "root",
      },
    ]);
    expect(store.getData("root")?.commits).toHaveLength(1);
  });

  it("should filter empty commits alt", () => {
    const store = createProfilerStore();
    store.setData([
      {
        commits: [
          { duration: 0, renderedUids: [] },
          { duration: 0, renderedUids: ["component"] },
        ],
        rootUid: "root",
      },
    ]);
    expect(store.getData("root")?.commits).toEqual([{ duration: 0, renderedUids: ["component"] }]);
  });

  it("should throw if component filters are modified while profiling", () => {
    const store = createProfilerStore();
    store.startProfiling();
    expect(() => store.setFilters(["Memo"])).toThrow("while profiling");
    store.stopProfiling();
    expect(() => store.setFilters(["Memo"])).not.toThrow();
  });

  it("should not throw if state contains a property hasOwnProperty", () => {
    const store = createProfilerStore();
    const data = { ...rootData, hasOwnProperty: true };
    expect(() => store.setData([data])).not.toThrow();
  });

  it("should not throw while initializing context values for Fibers within a not-yet-mounted subtree", () => {
    const store = createProfilerStore();
    expect(() => store.setData([{ commits: [], rootUid: "pending" }])).not.toThrow();
    expect(store.getData("pending")).toEqual({ commits: [], rootUid: "pending" });
  });
});
