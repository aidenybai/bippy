import { describe, expect, it } from "vite-plus/test";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { MAX_TIMER_TASKS, TimerQueue, type ScheduledTask } from "../src/evaluate/timers.js";
import {
  areValuesEquivalent,
  branchValue,
  getTruthiness,
  primitiveValue,
} from "../src/evaluate/values.js";

describe("guarded timer cancellation", () => {
  it("retains consumed work for a sibling execution path", () => {
    let journal: HeapJournal | null = null;
    const queue = new TimerQueue(undefined, undefined, (state) => journal?.recordState(state));
    let calls = 0;
    queue.enqueue(() => {
      calls++;
    });
    journal = new HeapJournal();
    queue.runNextTask();
    expect(calls).toBe(1);
    expect(queue.hasTasks()).toBe(false);
    journal.endPath();
    expect(queue.hasTasks()).toBe(true);
    queue.runNextTask();
    expect(calls).toBe(2);
    journal.endPath();
    journal.join("both paths consumed the task", null, 0, createPathPredicate("path", null));
    expect(queue.hasTasks()).toBe(false);
  });

  it("restores unhandled continuation registration on a discarded path", () => {
    const journal = new HeapJournal();
    const queue = new TimerQueue(undefined, undefined, (state) => journal.recordState(state));
    let calls = 0;
    queue.enqueue(() => {
      calls++;
    });
    journal.restore();
    expect(queue.hasTasks()).toBe(false);
    queue.runNextTask();
    expect(calls).toBe(0);
  });

  it("gives nested work its registration identity and parent", () => {
    const queue = new TimerQueue();
    const tasks: ScheduledTask[] = [];
    queue.schedule(queue.createHandle("timer"), () => {
      if (!queue.currentTask) throw new Error("Expected active timer");
      tasks.push(queue.currentTask);
      queue.queueMicrotask(() => {
        if (!queue.currentTask) throw new Error("Expected active microtask");
        tasks.push(queue.currentTask);
      });
    });
    queue.runNextTask();
    expect(tasks.map((task) => [task.id, task.kind])).toEqual([
      [1, "timer"],
      [2, "microtask"],
    ]);
    expect(tasks[0].parent).toBeNull();
    expect(tasks[1].parent).toBe(tasks[0]);
    expect(queue.currentTask).toBeNull();
  });

  it("bounds a microtask checkpoint without letting a timer overtake remaining work", () => {
    const queue = new TimerQueue();
    let calls = 0;
    const repeat = () => {
      calls++;
      queue.queueMicrotask(repeat);
    };
    queue.queueMicrotask(repeat);
    let didRunTimer = false;
    queue.enqueue(() => {
      didRunTimer = true;
    });
    queue.runNextTask();
    expect(calls).toBe(MAX_TIMER_TASKS);
    expect(queue.hasMicrotasks()).toBe(true);
    expect(didRunTimer).toBe(false);
  });

  it("restores task execution context after an internal failure", () => {
    const queue = new TimerQueue();
    const failure = new Error("internal failure");
    queue.enqueue(() => {
      throw failure;
    });
    expect(() => queue.runNextTask()).toThrow(failure);
    expect(queue.currentTask).toBeNull();
    expect(queue.isFlushing).toBe(false);
  });
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

  it("runs finite recursive timers without dropping repeated callbacks", () => {
    const queue = new TimerQueue();
    let count = 0;
    const tick = () => {
      count++;
      if (count < 3) queue.schedule(queue.createHandle("setTimeout"), tick, 10);
    };
    queue.schedule(queue.createHandle("setTimeout"), tick, 10);
    for (let index = 0; index < 3; index++) queue.runNextTask();
    expect(count).toBe(3);
    expect(queue.hasTasks()).toBe(false);
  });
});
