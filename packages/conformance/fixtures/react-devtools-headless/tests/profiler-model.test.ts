import { describe, expect, it, vi } from "vite-plus/test";
import { createProfilerModel } from "../src/profiler-model.js";
import type { ProfilerRootData } from "../src/profiler-model.js";

const roots: ProfilerRootData[] = [
  {
    commits: [{ componentUids: ["a"] }, { componentUids: ["a", "b"] }, { componentUids: ["b"] }],
    rootUid: "root-a",
  },
  { commits: [{ componentUids: ["c"] }], rootUid: "root-b" },
];

describe("upstream ProfilerContext model behavior", () => {
  it("updates updates profiling support based on the attached roots (legacy render)", () => {
    const model = createProfilerModel();
    model.setData(roots);
    expect(model.getState().selectedRootUid).toBe("root-a");
  });

  it("updates updates profiling support based on the attached roots (createRoot)", () => {
    const model = createProfilerModel();
    model.setData([roots[1]]);
    expect(model.getState().selectedRootUid).toBe("root-b");
  });

  it("should gracefully handle an empty profiling session (with no recorded commits)", () => {
    const model = createProfilerModel();
    model.setData([]);
    expect(model.getState()).toMatchObject({ selectedCommitIndex: null, selectedRootUid: null });
  });

  it("should auto-select the root ID matching the Components tab selection if it has profiling data (legacy render)", () => {
    const model = createProfilerModel();
    model.selectElement("c");
    model.setData(roots);
    expect(model.getState().selectedRootUid).toBe("root-b");
  });

  it("should auto-select the root ID matching the Components tab selection if it has profiling data (createRoot)", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.selectElement("c");
    expect(model.getState().selectedRootUid).toBe("root-b");
  });

  it("should not select the root ID matching the Components tab selection if it has no profiling data (legacy render)", () => {
    const model = createProfilerModel();
    model.selectElement("missing");
    model.setData(roots);
    expect(model.getState().selectedRootUid).toBe("root-a");
  });

  it("should not select the root ID matching the Components tab selection if it has no profiling data (createRoot)", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.selectElement("missing");
    expect(model.getState().selectedRootUid).toBe("root-a");
  });

  it("should maintain root selection between profiling sessions so long as there is data for that root (legacy render)", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.selectRoot("root-b");
    model.setData(roots);
    expect(model.getState().selectedRootUid).toBe("root-b");
  });

  it("should maintain root selection between profiling sessions so long as there is data for that root (createRoot)", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.selectRoot("root-b");
    model.setData([...roots].reverse());
    expect(model.getState().selectedRootUid).toBe("root-b");
  });

  it("should sync selected element in the Components tab too, provided the element is a match", () => {
    const onSelectElement = vi.fn();
    const model = createProfilerModel(onSelectElement);
    model.setData(roots);
    model.selectElement("b");
    expect(model.getState()).toMatchObject({ selectedCommitIndex: 1, selectedRootUid: "root-a" });
    expect(onSelectElement).toHaveBeenCalledWith("b");
  });

  it("should toggle profiling when the keyboard shortcut is pressed", () => {
    const model = createProfilerModel();
    model.toggleProfiling();
    expect(model.getState().isProfiling).toBe(true);
    model.toggleProfiling();
    expect(model.getState().isProfiling).toBe(false);
  });

  it("should navigate between commits when the keyboard shortcut is pressed", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.navigateCommits(1);
    expect(model.getState().selectedCommitIndex).toBe(1);
    model.navigateCommits(-1);
    expect(model.getState().selectedCommitIndex).toBe(0);
  });

  it("should reset commit index when switching to a different root", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.selectCommit(2);
    model.selectRoot("root-b");
    expect(model.getState().selectedCommitIndex).toBe(0);
  });

  it("should handle commit selection edge cases when filtering commits", () => {
    const model = createProfilerModel();
    model.setData(roots);
    model.selectCommit(1);
    model.setData([
      {
        commits: [
          { componentUids: ["a"] },
          { componentUids: ["a"], isVisible: false },
          { componentUids: ["b"] },
        ],
        rootUid: "root-a",
      },
    ]);
    expect(model.getState().selectedCommitIndex).toBe(0);
    model.navigateCommits(1);
    expect(model.getState().selectedCommitIndex).toBe(2);
  });
});
