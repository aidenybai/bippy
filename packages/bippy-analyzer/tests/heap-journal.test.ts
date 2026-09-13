import { describe, expect, it } from "vite-plus/test";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { createHookFrame, nextStateCell, queueStateUpdate } from "../src/evaluate/hooks.js";
import { createPathPredicate } from "../src/evaluate/predicates.js";
import { primitiveValue } from "../src/evaluate/values.js";

describe("guarded hook updates", () => {
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
