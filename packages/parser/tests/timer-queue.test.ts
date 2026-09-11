import { describe, expect, it } from "vite-plus/test";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { TimerQueue } from "../src/evaluate/timers.js";
import { getAlternativeGuards, createPathPredicate } from "../src/evaluate/predicates.js";
import { getTruthiness } from "../src/evaluate/values.js";

describe("guarded timer cancellation", () => {
  it("journals the first cancellation without making it unconditional", () => {
    let journal: HeapJournal | null = null;
    const queue = new TimerQueue(undefined, undefined, (state) => journal?.recordState(state));
    const handle = queue.createHandle("setTimeout");
    journal = new HeapJournal();
    queue.clear(handle);
    expect(queue.isCleared(handle)).toBe(true);
    journal.endPath();
    expect(queue.isCleared(handle)).toBe(false);
    journal.endPath();
    journal.join("cancelled conditionally", null, 0, createPathPredicate("cancel", null));
    const cancellation = queue.getCancellation(handle);
    expect(cancellation.kind).toBe("branch");
    if (cancellation.kind !== "branch") return;
    expect(cancellation.alternatives.map(getTruthiness)).toEqual([true, false]);
    expect(getAlternativeGuards(cancellation)?.guards).toHaveLength(2);
    expect(queue.isCleared(handle)).toBe(false);
  });

  it("keeps a timer inactive on paths that did not create its handle", () => {
    const journal = new HeapJournal();
    const queue = new TimerQueue(undefined, undefined, (state) => journal.recordState(state));
    const handle = queue.createHandle("setTimeout");
    expect(queue.isCleared(handle)).toBe(false);
    journal.endPath();
    expect(queue.isCleared(handle)).toBe(true);
    journal.endPath();
    journal.join("created conditionally", null, 0, createPathPredicate("create", null));
    const cancellation = queue.getCancellation(handle);
    expect(cancellation.kind).toBe("branch");
    if (cancellation.kind !== "branch") return;
    expect(cancellation.alternatives.map(getTruthiness)).toEqual([false, true]);
    expect(getAlternativeGuards(cancellation)?.guards).toHaveLength(2);
  });

  it("does not execute a timer from a discarded path", () => {
    const journal = new HeapJournal();
    const queue = new TimerQueue(undefined, undefined, (state) => journal.recordState(state));
    const handle = queue.createHandle("setTimeout");
    let hasRun = false;
    queue.schedule(handle, () => {
      hasRun = true;
    });
    journal.endPath();
    queue.runNextTask();
    expect(hasRun).toBe(false);
  });

  it("does not invoke an unconditionally cancelled task", () => {
    const queue = new TimerQueue();
    const handle = queue.createHandle("setTimeout");
    let hasRun = false;
    queue.schedule(handle, () => {
      hasRun = true;
    });
    queue.clear(handle);
    queue.runNextTask();
    expect(hasRun).toBe(false);
  });
});
