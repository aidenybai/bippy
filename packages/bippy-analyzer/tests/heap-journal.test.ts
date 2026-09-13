import { describe, expect, it } from "vite-plus/test";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import {
  beginHookPass,
  commitHookPass,
  createHookFrame,
  nextStateCell,
  queueReducerAction,
  queueStateUpdate,
} from "../src/evaluate/hooks.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import { primitiveValue } from "../src/evaluate/values.js";

describe("guarded hook updates", () => {
  it("preserves alternative reducer queues and their shared prefix", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "reducer", () => primitiveValue(0));
    queueReducerAction(frame, cell, primitiveValue(1), false);
    const original = cell.pendingReducerActions;
    const journal = new HeapJournal();
    frame.recordUpdate = (updated) => journal.recordStateUpdate(updated);
    const predicate = createPathPredicate("queued action", null);
    queueReducerAction(frame, cell, primitiveValue(2), false);
    journal.endPath();
    expect(cell.pendingReducerActions).toBe(original);
    queueReducerAction(frame, cell, primitiveValue(3), false);
    journal.endPath();
    journal.join("queued action", null, 0, predicate);
    frame.recordUpdate = null;
    queueReducerAction(frame, cell, primitiveValue(4), false);
    expect(cell.current).toEqual(primitiveValue(0));
    expect(cell.pendingReducerActions).toMatchObject({
      kind: "branch",
      predicate,
      alternatives: [
        { kind: "list", items: [primitiveValue(1), primitiveValue(2), primitiveValue(4)] },
        { kind: "list", items: [primitiveValue(1), primitiveValue(3), primitiveValue(4)] },
      ],
    });
  });

  it("keeps an absent dispatch as an empty queue rather than a state value", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "reducer", () => primitiveValue(8));
    const journal = new HeapJournal();
    frame.recordUpdate = (updated) => journal.recordStateUpdate(updated);
    queueReducerAction(frame, cell, primitiveValue(2), false);
    journal.endPath();
    journal.endPath();
    journal.join("optional dispatch", null, 0, createPathPredicate("optional dispatch", null));
    expect(cell.pendingReducerActions).toMatchObject({
      kind: "branch",
      alternatives: [
        { kind: "list", items: [primitiveValue(2)] },
        { kind: "list", items: [] },
      ],
    });
  });

  it("records a state change when a queued reducer becomes escaped", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "reducer", () => primitiveValue(0));
    queueReducerAction(frame, cell, primitiveValue(1), false);
    queueReducerAction(frame, cell, primitiveValue(2), true);
    expect(commitHookPass(frame)).toEqual([cell]);
    expect(cell.current).not.toEqual(primitiveValue(0));
    expect(cell.pendingReducerActions).not.toBeNull();
    expect(frame.didStateChange).toBe(true);
  });

  it("distinguishes a retained batch from dispatch during the current render", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "reducer", () => primitiveValue(0));
    queueReducerAction(frame, cell, primitiveValue(1), false);
    expect(commitHookPass(frame)).toEqual([cell]);
    beginHookPass(frame);
    expect(commitHookPass(frame)).toEqual([]);
    beginHookPass(frame);
    queueReducerAction(frame, cell, primitiveValue(2), false);
    expect(commitHookPass(frame)).toEqual([cell]);
  });

  it("does not treat an unbounded dispatch loop as one optional action", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "reducer", () => primitiveValue(0));
    const journal = new HeapJournal();
    frame.recordUpdate = (updated) => journal.recordStateUpdate(updated);
    queueReducerAction(frame, cell, primitiveValue(1), false);
    journal.endPath();
    journal.endPath();
    journal.join("unbounded dispatch", null, 0, null, true);
    expect(cell.pendingReducerActions).toMatchObject({
      kind: "unknown",
      reason: "reducer dispatch count is not bounded",
    });
  });

  it("excludes owned queues only from their outer journal", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "reducer", () => primitiveValue(0));
    const outer = new HeapJournal(new Set([cell]));
    const inner = new HeapJournal();
    frame.recordUpdate = (updated) => {
      outer.recordStateUpdate(updated);
      inner.recordStateUpdate(updated);
    };
    queueReducerAction(frame, cell, primitiveValue(1), false);
    inner.endPath();
    inner.endPath();
    inner.join("inner", null, 0, createPathPredicate("inner", null));
    const conditionalQueue = cell.pendingReducerActions;
    outer.endPath();
    outer.endPath();
    outer.join("outer", null, 0, createPathPredicate("outer", null));
    expect(cell.pendingReducerActions).toBe(conditionalQueue);
  });

  it("leaves excluded cells unconditional while joining other cells", () => {
    const frame = createHookFrame();
    const ownedCell = nextStateCell(frame, "owned", () => primitiveValue(0));
    const externalCell = nextStateCell(frame, "external", () => primitiveValue(0));
    const journal = new HeapJournal(new Set([ownedCell]));
    frame.recordUpdate = (cell) => journal.recordStateUpdate(cell);
    const updated = primitiveValue(1);
    const predicate = createPathPredicate("conditional effect", null);
    queueStateUpdate(frame, ownedCell, updated, false);
    queueStateUpdate(frame, externalCell, updated, false);
    journal.endPath();
    expect(ownedCell.next).toBe(updated);
    expect(externalCell.next).toBeNull();
    journal.endPath();
    journal.join("conditional effect", null, 0, predicate);
    expect(ownedCell.next).toBe(updated);
    expect(externalCell.next).toMatchObject({
      kind: "branch",
      alternatives: [updated, externalCell.current],
      predicate,
    });
  });

  it("does not exclude a cell from nested conditional journals", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "owned", () => primitiveValue(0));
    const ownerJournal = new HeapJournal(new Set([cell]));
    const nestedJournal = new HeapJournal();
    frame.recordUpdate = (updatedCell) => {
      ownerJournal.recordStateUpdate(updatedCell);
      nestedJournal.recordStateUpdate(updatedCell);
    };
    const predicate = createPathPredicate("conditional callback body", null);
    queueStateUpdate(frame, cell, primitiveValue(1), false);
    nestedJournal.endPath();
    nestedJournal.endPath();
    nestedJournal.join("conditional callback body", null, 0, predicate);
    const nestedUpdate = cell.next;
    expect(nestedUpdate).toMatchObject({ kind: "branch", predicate });
    ownerJournal.endPath();
    ownerJournal.endPath();
    ownerJournal.join("conditional effect", null, 0, createPathPredicate("effect", null));
    expect(cell.next).toBe(nestedUpdate);
  });
});
