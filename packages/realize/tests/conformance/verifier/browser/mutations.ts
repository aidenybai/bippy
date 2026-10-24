import type { Fiber } from "bippy";
import { forEachPlainObject, isPlainData, snapshotValue } from "../snapshot";
import { getStateOwner } from "../types";
import type { Capture, MutationHit } from "../types";
import { isLibraryHookQueue } from "../write-origins";
import { getQueuedHooks, getRenderCount } from "./fibers";
import {
  findPropOwner,
  findTrackedTarget,
  getPropWrites,
  getWriteCount,
  resetPropWrites,
  trackWrites,
} from "./write-tracking";

interface PendingMutationHit {
  id: string;
  target: object;
  writeCount: number;
  snapshot: string;
  renderCount: number;
}

interface TrackedState {
  owner: string;
  target: object;
  snapshot: string;
}

let pendingMutationHits: PendingMutationHit[] = [];
let trackedStates: TrackedState[] = [];
let stateOwners = new WeakMap<object, string>();

export const recordMutationProbe = (id: string, value: unknown): unknown => {
  if (!isPlainData(value)) return value;
  const trackedTarget = findTrackedTarget(value);
  const target = trackedTarget ?? value;
  pendingMutationHits.push({
    id,
    target,
    writeCount: getWriteCount(target),
    snapshot: snapshotValue(target),
    renderCount: getRenderCount(),
  });
  return trackedTarget ? value : trackWrites(target, false);
};

const getStateOwners = (states: unknown[]): Map<object, string> => {
  const owners = new Map<object, string>();
  states.forEach((state, hookIndex) =>
    forEachPlainObject(state, (object) => {
      if (!owners.has(object)) owners.set(object, getStateOwner(hookIndex));
    }),
  );
  return owners;
};

export const trackStates = (fiber: Fiber): Map<object, string> => {
  const hooks = getQueuedHooks(fiber);
  hooks.forEach((hook, hookIndex) => {
    const state = hook.memoizedState;
    if (!isPlainData(state) || isLibraryHookQueue(hook.queue)) return;
    if (trackedStates.some((tracked) => tracked.target === state)) return;
    trackedStates.push({
      owner: getStateOwner(hookIndex),
      target: state,
      snapshot: snapshotValue(state),
    });
  });
  const currentOwners = getStateOwners(hooks.map((hook) => hook.memoizedState));
  for (const [object, owner] of currentOwners)
    if (!stateOwners.has(object)) stateOwners.set(object, owner);
  return currentOwners;
};

export const takeMutations = (fiber: Fiber): Pick<Capture, "mutationHits" | "mutatedOwners"> => {
  const currentOwners = trackStates(fiber);
  const mutatedOwners = new Set(getPropWrites());
  for (const tracked of trackedStates)
    if (snapshotValue(tracked.target) !== tracked.snapshot) mutatedOwners.add(tracked.owner);
  const mutationHits = new Map<string, MutationHit>();
  for (const hit of pendingMutationHits) {
    const owner = stateOwners.get(hit.target) ?? findPropOwner(hit.target) ?? null;
    const isWritten =
      getWriteCount(hit.target) > hit.writeCount || snapshotValue(hit.target) !== hit.snapshot;
    const isLost =
      isWritten && currentOwners.has(hit.target) && getRenderCount() === hit.renderCount;
    const key = `${hit.id}:${owner}`;
    const previous = mutationHits.get(key);
    mutationHits.set(key, {
      id: hit.id,
      owner,
      isWritten: isWritten || (previous?.isWritten ?? false),
      isLost: isLost || (previous?.isLost ?? false),
    });
  }
  pendingMutationHits = [];
  resetPropWrites();
  trackedStates = [];
  trackStates(fiber);
  return { mutationHits: [...mutationHits.values()], mutatedOwners: [...mutatedOwners] };
};

export const resetMutationTracking = (): void => {
  pendingMutationHits = [];
  trackedStates = [];
  stateOwners = new WeakMap();
  resetPropWrites();
};
