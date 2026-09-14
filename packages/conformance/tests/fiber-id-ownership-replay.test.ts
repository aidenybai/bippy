import {
  getFiberById,
  getFiberId,
  getRDTHook,
  instrument,
  setFiberId,
  type FiberRoot,
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

const runInheritedOwnership = (
  currentIndex: number,
  deletedIndex: number,
  isClaimantDeleted: boolean,
): string[] => {
  const target: ReactDevToolsTarget = {};
  using _unsubscribe = instrument({ target });
  const hook = getRDTHook(undefined, target);
  const roots = [createFiber({ tag: 3 }), createFiber({ tag: 3 })];
  const root: FiberRoot = { current: roots[currentIndex] };
  const pair = roots.map((parent) => createFiber({ return: parent }));
  for (const index of [0, 1]) {
    roots[index].stateNode = root;
    roots[index].alternate = roots[1 - index];
    roots[index].child = pair[index];
    pair[index].alternate = pair[1 - index];
  }
  const claimant = createFiber();
  const generated = createFiber();
  const reservations = [createFiber(), createFiber()];
  const identifiers = reservations.map(getFiberId);
  for (const fiber of reservations) hook.onCommitFiberUnmount(1, fiber);
  const transcript: string[] = [];
  const verify = (expectedOwners: Array<string | null>): void => {
    const owners = identifiers.map((identifier) => {
      const fiber = getFiberById(identifier);
      if (fiber === null) return null;
      if (fiber === claimant) return "claimant";
      if (fiber === root.current.child) return "current";
      return "wrong-fiber";
    });
    expect(owners).toEqual(expectedOwners);
    transcript.push(JSON.stringify({ current: roots.indexOf(root.current), owners }));
  };
  try {
    setFiberId(pair[0], identifiers[0]);
    verify(["current", null]);
    setFiberId(claimant, identifiers[0]);
    verify(["claimant", null]);
    if (isClaimantDeleted) hook.onCommitFiberUnmount(1, claimant);
    expect(getFiberId(pair[1])).toBe(identifiers[0]);
    const inheritedOwner = isClaimantDeleted ? "current" : "claimant";
    verify([inheritedOwner, null]);
    root.current = roots[1 - currentIndex];
    expect(getFiberId(pair[0])).toBe(identifiers[0]);
    expect(getFiberId(pair[1])).toBe(identifiers[0]);
    verify([inheritedOwner, null]);
    setFiberId(pair[0], identifiers[1]);
    expect(getFiberId(pair[1])).toBe(identifiers[0]);
    verify([inheritedOwner, "current"]);
    const generatedIdentifier = getFiberId(generated);
    expect(generatedIdentifier).toBeGreaterThan(identifiers[1]);
    expect(getFiberById(generatedIdentifier) === generated).toBe(true);
    root.current = roots[currentIndex];
    verify([inheritedOwner, "current"]);
    hook.onCommitFiberUnmount(1, pair[deletedIndex]);
    verify([isClaimantDeleted ? null : "claimant", null]);
    expect(getFiberById(generatedIdentifier) === generated).toBe(true);
    hook.onCommitFiberUnmount(1, claimant);
    verify([null, null]);
    hook.onCommitFiberUnmount(1, generated);
    expect(getFiberById(generatedIdentifier)).toBeNull();
  } finally {
    for (const fiber of [...pair, claimant, generated]) hook.onCommitFiberUnmount(1, fiber);
  }
  return transcript;
};

it.each(
  [0, 1].flatMap((currentIndex) =>
    [0, 1].flatMap((deletedIndex) =>
      [false, true].map((isClaimantDeleted) => ({ currentIndex, deletedIndex, isClaimantDeleted })),
    ),
  ),
)(
  "inherits an alternate ID without stealing a live claim, current $currentIndex, delete $deletedIndex, claimant deleted $isClaimantDeleted",
  ({ currentIndex, deletedIndex, isClaimantDeleted }) => {
    expect(runInheritedOwnership(currentIndex, deletedIndex, isClaimantDeleted)).toEqual(
      runInheritedOwnership(currentIndex, deletedIndex, isClaimantDeleted),
    );
  },
);

it.each([0, 1, 2])(
  "preserves the last explicit ID owner through unrelated reassignment and deletion, original owner %i",
  (owner) => {
    expect(runIdOwnership(owner)).toEqual(runIdOwnership(owner));
  },
);
