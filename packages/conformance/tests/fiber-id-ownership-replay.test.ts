import {
  getFiberById,
  getFiberId,
  getRDTHook,
  instrument,
  setFiberId,
  type ReactDevToolsTarget,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";

interface IdOperation {
  owner: number;
  slot: number | null;
}

const runIdOwnership = (originalOwner: number): string[] => {
  const target: ReactDevToolsTarget = {};
  using _unsubscribe = instrument({ target });
  const hook = getRDTHook(undefined, target);
  const transcript: string[] = [];
  const schedules: IdOperation[][] = [];
  for (const nextOwner of [0, 1, 2].filter((owner) => owner !== originalOwner)) {
    for (const previousSlot of [0, 1, 2]) {
      for (const nextSlot of [0, 1, 2]) {
        schedules.push([
          { owner: originalOwner, slot: previousSlot },
          { owner: nextOwner, slot: previousSlot },
          { owner: originalOwner, slot: nextSlot },
          { owner: originalOwner, slot: null },
          { owner: nextOwner, slot: previousSlot },
          { owner: originalOwner, slot: nextSlot },
          { owner: nextOwner, slot: null },
          { owner: originalOwner, slot: null },
        ]);
      }
    }
  }
  for (const [scheduleIndex, schedule] of schedules.entries()) {
    const fibers = [0, 1, 2].map((owner) => createFiber({ key: String(owner) }));
    const reservations = [0, 1, 2].map(() => createFiber());
    const identifiers = reservations.map(getFiberId);
    for (const fiber of reservations) hook.onCommitFiberUnmount(1, fiber);
    const assignedSlots = new Map<number, number>();
    const reverseOwners = new Map<number, number>();
    try {
      for (const [step, { owner, slot }] of schedule.entries()) {
        const previousSlot = assignedSlots.get(owner);
        if (previousSlot !== undefined && reverseOwners.get(previousSlot) === owner)
          reverseOwners.delete(previousSlot);
        if (slot === null) {
          assignedSlots.delete(owner);
          hook.onCommitFiberUnmount(1, fibers[owner]);
        } else {
          assignedSlots.set(owner, slot);
          reverseOwners.set(slot, owner);
          setFiberId(fibers[owner], identifiers[slot]);
        }
        const context = JSON.stringify({ originalOwner, scheduleIndex, step, schedule });
        const actualOwners = identifiers.map((identifier) => {
          const fiber = getFiberById(identifier);
          return fiber === null ? null : fibers.indexOf(fiber);
        });
        const expectedOwners = identifiers.map(
          (_, slotIndex) => reverseOwners.get(slotIndex) ?? null,
        );
        expect(actualOwners, context).toEqual(expectedOwners);
        for (const [assignedOwner, assignedSlot] of assignedSlots)
          expect(getFiberId(fibers[assignedOwner]), context).toBe(identifiers[assignedSlot]);
        transcript.push(JSON.stringify({ owner, slot, actualOwners }));
      }
    } finally {
      for (const fiber of fibers) hook.onCommitFiberUnmount(1, fiber);
    }
    for (const identifier of identifiers) expect(getFiberById(identifier)).toBeNull();
  }
  return transcript;
};

it.each([0, 1, 2])(
  "preserves the last explicit ID owner through unrelated reassignment and deletion, original owner %i",
  (owner) => {
    expect(runIdOwnership(owner)).toEqual(runIdOwnership(owner));
  },
);
