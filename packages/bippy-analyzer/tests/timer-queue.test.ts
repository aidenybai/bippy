import { describe, expect, it } from "vite-plus/test";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { TimerQueue } from "../src/evaluate/timers.js";
import {
  areValuesEquivalent,
  branchValue,
  getTruthiness,
  primitiveValue,
} from "../src/evaluate/values.js";

describe("guarded timer cancellation", () => {
  it("does not interrupt a running microtask with a nested checkpoint", () => {
    const queue = new TimerQueue();
    const order: string[] = [];
    queue.queueMicrotask(() => {
      order.push("first start");
      queue.queueMicrotask(() => order.push("third"));
      queue.drainMicrotasks();
      order.push("first end");
    });
    queue.queueMicrotask(() => order.push("second"));

    queue.drainMicrotasks();

    expect(order).toEqual(["first start", "first end", "second", "third"]);
  });

  it("preserves distinct handles with the same numeric range", () => {
    const queue = new TimerQueue();
    const firstHandle = queue.createHandle("setTimeout");
    const secondHandle = queue.createHandle("setTimeout");
    expect(branchValue([firstHandle, secondHandle], "selected handle").kind).toBe("branch");
    expect(areValuesEquivalent(firstHandle, secondHandle)).toBe(false);
  });

  it("cancels a handle through a copied abstract value", () => {
    const queue = new TimerQueue();
    const handle = queue.createHandle("setTimeout");
    let hasRun = false;
    queue.schedule(handle, () => {
      hasRun = true;
    });
    queue.clear({ ...handle });
    queue.runNextTask();
    expect(hasRun).toBe(false);
  });

  it("journals the first cancellation without making it unconditional", () => {
    let journal: HeapJournal | null = null;
    const queue = new TimerQueue(undefined, undefined, (state) => journal?.recordState(state));
    const handle = queue.createHandle("setTimeout");
    queue.schedule(handle, () => {});
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

  it("does not record cancellation of an absent timer as progress", () => {
    let mutations = 0;
    const queue = new TimerQueue(undefined, undefined, () => {
      mutations++;
    });
    queue.clear(primitiveValue(0));
    queue.clear(primitiveValue(undefined));
    queue.clear(queue.createHandle("setTimeout"));
    expect(mutations).toBe(0);
    expect(queue.hasTasks()).toBe(false);
  });

  it("does not record an unscheduled handle as a queue mutation", () => {
    let mutations = 0;
    const queue = new TimerQueue(undefined, undefined, () => {
      mutations++;
    });
    queue.createHandle("setTimeout");
    expect(mutations).toBe(0);
  });

  it("keeps a timer inactive on paths that did not schedule it", () => {
    const journal = new HeapJournal();
    const queue = new TimerQueue(undefined, undefined, (state) => journal.recordState(state));
    const handle = queue.createHandle("setTimeout");
    queue.schedule(handle, () => {});
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

  it.each(["timer", "microtask"])("does not execute a %s from a discarded path", (kind) => {
    const journal = new HeapJournal();
    const queue = new TimerQueue(undefined, undefined, (state) => journal.recordState(state));
    const handle = queue.createHandle("setTimeout");
    let hasRun = false;
    const task = () => {
      hasRun = true;
    };
    if (kind === "microtask") queue.queueMicrotask(task, handle);
    else queue.schedule(handle, task);
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

  it("settles a timer that recursively schedules its call site", () => {
    const queue = new TimerQueue();
    const firstHandle = queue.createHandle("setTimeout");
    const nextHandle = queue.createHandle("setTimeout");
    let isNextScheduled = true;
    queue.schedule(
      firstHandle,
      () => {
        isNextScheduled = queue.schedule(nextHandle, () => {}, 1000, "poll");
      },
      1000,
      "poll",
    );
    queue.runNextTask();
    expect(isNextScheduled).toBe(false);
    expect(queue.hasTasks()).toBe(false);
  });
});
