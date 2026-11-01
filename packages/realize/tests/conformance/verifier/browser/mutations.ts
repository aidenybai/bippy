import type { Fiber } from "bippy";
import { forEachPlainObject, isPlainData, snapshotValue } from "../snapshot";
import { getStateOrigin } from "../types";
import type { Capture, MutationHit } from "../types";
import { isLibraryHookQueue } from "../write-origins";
import { getQueuedHooks, getRenderCount } from "./fibers";
import {
  findPropOrigin,
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
  origin: string;
  target: object;
  snapshot: string;
}

let pendingMutationHits: PendingMutationHit[] = [];
let trackedStates: TrackedState[] = [];
let stateOrigins = new WeakMap<object, string>();

export const recordMutationHit = (id: string, value: unknown): unknown => {
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

const getStateOrigins = (states: unknown[]): Map<object, string> => {
  const origins = new Map<object, string>();
  states.forEach((state, hookIndex) =>
    forEachPlainObject(state, (object) => {
      if (!origins.has(object)) origins.set(object, getStateOrigin(hookIndex));
    }),
  );
  return origins;
};

export const trackStates = (fiber: Fiber): Map<object, string> => {
  const hooks = getQueuedHooks(fiber);
  hooks.forEach((hook, hookIndex) => {
    const state = hook.memoizedState;
    if (!isPlainData(state) || isLibraryHookQueue(hook.queue)) return;
    if (trackedStates.some((tracked) => tracked.target === state)) return;
    trackedStates.push({
      origin: getStateOrigin(hookIndex),
      target: state,
      snapshot: snapshotValue(state),
    });
  });
  const currentOrigins = getStateOrigins(hooks.map((hook) => hook.memoizedState));
  for (const [object, origin] of currentOrigins)
    if (!stateOrigins.has(object)) stateOrigins.set(object, origin);
  return currentOrigins;
};

export const takeMutations = (fiber: Fiber): Pick<Capture, "mutationHits" | "mutatedOrigins"> => {
  const currentOrigins = trackStates(fiber);
  const mutatedOrigins = new Set(getPropWrites());
  for (const tracked of trackedStates)
    if (snapshotValue(tracked.target) !== tracked.snapshot) mutatedOrigins.add(tracked.origin);
  const mutationHits = new Map<string, MutationHit>();
  for (const hit of pendingMutationHits) {
    const origin = stateOrigins.get(hit.target) ?? findPropOrigin(hit.target) ?? null;
    const isWritten =
      getWriteCount(hit.target) > hit.writeCount || snapshotValue(hit.target) !== hit.snapshot;
    const isLost =
      isWritten && currentOrigins.has(hit.target) && getRenderCount() === hit.renderCount;
    const key = `${hit.id}:${origin}`;
    const previous = mutationHits.get(key);
    mutationHits.set(key, {
      id: hit.id,
      origin,
      isWritten: isWritten || (previous?.isWritten ?? false),
      isLost: isLost || (previous?.isLost ?? false),
    });
  }
  pendingMutationHits = [];
  resetPropWrites();
  trackedStates = [];
  trackStates(fiber);
  return { mutationHits: [...mutationHits.values()], mutatedOrigins: [...mutatedOrigins] };
};

export const resetMutationTracking = (): void => {
  pendingMutationHits = [];
  trackedStates = [];
  stateOrigins = new WeakMap();
  resetPropWrites();
};
