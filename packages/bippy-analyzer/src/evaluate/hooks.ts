import type { StaticNativeFunctionValue, StaticValue } from "../types.js";
import { getStatePredicate } from "./predicates.js";
import {
  areValuesEquivalent,
  branchValue,
  compareIdentity,
  TRUE_VALUE,
  getTruthiness,
  listValue,
  mapValue,
  unknownValue,
} from "./values.js";

export interface HookPendingUpdate {
  next: StaticValue | null;
  pendingPresence?: StaticValue;
  pendingReducerActions: StaticValue | null;
}

export interface StateCell extends HookPendingUpdate {
  name: string;
  initial: StaticValue;
  current: StaticValue;
  setter: StaticNativeFunctionValue | null;
  deferred: StaticValue[];
  isEscaped: boolean;
}

export interface MemoCell {
  value: StaticValue;
  deps: StaticValue | null;
}

export interface EffectRecord {
  isLayout: boolean;
  callback: StaticValue;
  deps: StaticValue | null;
  cleanup: StaticValue | null;
}

export interface EffectCall {
  (callback: StaticValue): StaticValue;
}

/**
 * Hook storage for one component instance, indexed by call order like React's
 * `workInProgressHook` list. `isDeferred` is set once evaluation passes an
 * `await` of an unknown promise: updates queued from there land after the
 * captured commit, so they are treated as escaped rather than applied.
 * `isFrozen` is set once the state failed to settle: the cells that kept
 * changing hold unknown values and further updates no longer schedule passes.
 * `requestRender` is the owner's `scheduleUpdateOnFiber`: an update queued
 * outside its render (from another component's effect, a store listener) must
 * still produce a pass. `recordUpdate` journals a cell's pending update like a
 * heap write, so an update queued on one path of a fork is undone on the others.
 */
export interface HookFrame {
  cells: StateCell[];
  cursor: number;
  memoCells: MemoCell[];
  memoCursor: number;
  effects: EffectRecord[];
  isRendering: boolean;
  isDeferred: boolean;
  isFrozen: boolean;
  doublesHookFactories: boolean;
  didStateChange: boolean;
  hasRenderPhaseReducerUpdate: boolean;
  requestRender: (() => void) | null;
  recordUpdateCause: (() => void) | null;
  recordUpdate: ((cell: StateCell) => void) | null;
  recordIncomingUpdates: (() => void) | null;
}

export const createHookFrame = (
  doublesHookFactories = false,
  recordUpdate: HookFrame["recordUpdate"] = null,
): HookFrame => ({
  cells: [],
  cursor: 0,
  memoCells: [],
  memoCursor: 0,
  effects: [],
  isRendering: false,
  isDeferred: false,
  isFrozen: false,
  doublesHookFactories,
  didStateChange: false,
  hasRenderPhaseReducerUpdate: false,
  requestRender: null,
  recordUpdateCause: null,
  recordUpdate,
  recordIncomingUpdates: null,
});

/**
 * Runs a hook's user function (`useState`/`useReducer` initializer, `useMemo`
 * factory) as `shouldDoubleInvokeUserFnsInHooksDEV` does: under Strict Mode on
 * React 19+ the function runs twice and the first result is kept.
 */
export const invokeHookFactory = (
  frame: HookFrame | null,
  compute: () => StaticValue,
): StaticValue => {
  const value = compute();
  if (frame?.doublesHookFactories) compute();
  return value;
};

/**
 * Starts a render pass; a render-phase update or a Strict Mode double render
 * re-runs the body against the same committed effects, as `renderWithHooksAgain` does.
 */
export const beginHookPass = (frame: HookFrame): void => {
  frame.cursor = 0;
  frame.memoCursor = 0;
  frame.effects = [];
  frame.didStateChange = false;
  frame.hasRenderPhaseReducerUpdate = false;
  frame.isRendering = true;
};

export const capturePendingHookUpdate = (cell: HookPendingUpdate): HookPendingUpdate => ({
  next: cell.next,
  pendingPresence: cell.pendingPresence,
  pendingReducerActions: cell.pendingReducerActions,
});

export const restorePendingHookUpdate = (
  cell: HookPendingUpdate,
  update: HookPendingUpdate,
): void => {
  cell.next = update.next;
  cell.pendingPresence = update.pendingPresence;
  cell.pendingReducerActions = update.pendingReducerActions;
};

interface HookRenderCellSnapshot extends HookPendingUpdate {
  cell: StateCell;
  current: StaticValue;
  completedUpdate: HookPendingUpdate | null;
}

interface HookRenderCheckpoint {
  complete: () => void;
  discard: () => void;
  recordIncomingUpdates: () => void;
}

export interface HookRenderAttempt extends Pick<HookRenderCheckpoint, "complete" | "discard"> {
  commit: () => void;
}

const getRebasedReducerActions = (
  original: StaticValue | null,
  completed: StaticValue | null,
  current: StaticValue | null,
): StaticValue | null => {
  if (current === completed || current === null) return original;
  if (original === null && completed === null) return current;
  return mapValue(original ?? listValue([]), (originalQueue) =>
    mapValue(completed ?? listValue([]), (completedQueue) =>
      mapValue(current, (currentQueue) => {
        if (
          originalQueue.kind !== "list" ||
          completedQueue.kind !== "list" ||
          currentQueue.kind !== "list" ||
          !completedQueue.items.every((action, index) => action === currentQueue.items[index])
        ) {
          return unknownValue("reducer queue cannot be rebased after a discarded render");
        }
        return listValue([
          ...originalQueue.items,
          ...currentQueue.items.slice(completedQueue.items.length),
        ]);
      }),
    ),
  );
};

const getHookRenderCheckpoint = (frame: HookFrame): HookRenderCheckpoint => {
  const stateCells: HookRenderCellSnapshot[] = frame.cells.map((cell) => ({
    cell,
    current: cell.current,
    ...capturePendingHookUpdate(cell),
    completedUpdate: null,
  }));
  const metadata = {
    memoCells: [...frame.memoCells],
    effects: frame.effects,
    cursor: frame.cursor,
    memoCursor: frame.memoCursor,
    isFrozen: frame.isFrozen,
    didStateChange: frame.didStateChange,
    hasRenderPhaseReducerUpdate: frame.hasRenderPhaseReducerUpdate,
  };
  return {
    recordIncomingUpdates: () => {
      for (const snapshot of stateCells) {
        const completed = snapshot.completedUpdate;
        if (!completed) continue;
        const pending = capturePendingHookUpdate(snapshot.cell);
        if (
          pending.next !== completed.next ||
          pending.pendingPresence !== completed.pendingPresence
        ) {
          snapshot.next = pending.next;
          snapshot.pendingPresence = pending.pendingPresence;
        }
        snapshot.pendingReducerActions = getRebasedReducerActions(
          snapshot.pendingReducerActions,
          completed.pendingReducerActions,
          pending.pendingReducerActions,
        );
        snapshot.completedUpdate = null;
      }
    },
    complete: () => {
      for (const snapshot of stateCells) {
        snapshot.completedUpdate = capturePendingHookUpdate(snapshot.cell);
      }
    },
    discard: () => {
      frame.cells = stateCells.map(
        ({ cell, current, next, pendingPresence, pendingReducerActions, completedUpdate }) => {
          cell.current = current;
          if (
            !completedUpdate ||
            (cell.next === completedUpdate.next &&
              cell.pendingPresence === completedUpdate.pendingPresence)
          ) {
            cell.next = next;
            cell.pendingPresence = pendingPresence;
          }
          cell.pendingReducerActions = completedUpdate
            ? getRebasedReducerActions(
                pendingReducerActions,
                completedUpdate.pendingReducerActions,
                cell.pendingReducerActions,
              )
            : pendingReducerActions;
          return cell;
        },
      );
      Object.assign(frame, metadata);
    },
  };
};

export const createHookRenderAttempt = (frame: HookFrame): HookRenderAttempt => {
  if (frame.recordIncomingUpdates) throw new Error("Hook frame already has a render attempt");
  let checkpoint: HookRenderCheckpoint | null = getHookRenderCheckpoint(frame);
  frame.recordIncomingUpdates = checkpoint.recordIncomingUpdates;
  const finish = (): HookRenderCheckpoint | null => {
    const previous = checkpoint;
    if (previous) {
      frame.recordIncomingUpdates = null;
      checkpoint = null;
    }
    return previous;
  };
  return {
    complete: () => checkpoint?.complete(),
    commit: () => {
      finish();
    },
    discard: () => finish()?.discard(),
  };
};

export const runHookRender = <Result>(
  frame: HookFrame,
  render: () => Result,
  pendingAttempt?: HookRenderAttempt,
): Result => {
  const attempt = pendingAttempt ?? createHookRenderAttempt(frame);
  try {
    const result = render();
    if (pendingAttempt) attempt.complete();
    else attempt.commit();
    return result;
  } catch (error) {
    attempt.discard();
    throw error;
  } finally {
    frame.isRendering = false;
  }
};

export const nextStateCell = (
  frame: HookFrame,
  name: string,
  computeInitial: () => StaticValue,
): StateCell => {
  const index = frame.cursor++;
  const existing = frame.cells[index];
  if (existing) return existing;
  const initial = computeInitial();
  const cell: StateCell = {
    name,
    initial,
    current: initial,
    next: null,
    pendingReducerActions: null,
    setter: null,
    deferred: [],
    isEscaped: false,
  };
  frame.cells[index] = cell;
  return cell;
};

/**
 * Mirrors `updateMemo`/`updateRef`: the stored value is reused while the
 * dependency list is unchanged; `deps === null` keeps it for the instance's
 * lifetime, as for refs.
 */
export const nextMemoCell = (
  frame: HookFrame,
  deps: StaticValue | null,
  compute: () => StaticValue,
): StaticValue => {
  const index = frame.memoCursor++;
  const existing = frame.memoCells[index];
  if (existing && (deps === null || areDepsEqual(existing.deps, deps))) return existing.value;
  const cell: MemoCell = { value: compute(), deps };
  frame.memoCells[index] = cell;
  return cell.value;
};

/** `Object.is` on hook values: decided identity, else values analysis cannot tell apart count as the same. */
const isSameHookValue = (left: StaticValue, right: StaticValue): boolean =>
  compareIdentity(left, right) ?? areValuesEquivalent(left, right);

export const escapedStateValue = (cell: StateCell): StaticValue =>
  branchValue(
    [cell.initial, unknownValue(`updated state of ${cell.name}`)],
    "state setter escapes to code that is not evaluated",
    null,
    0,
    getStatePredicate(cell, cell.name),
  );

export const getQueuedState = (cell: StateCell): StaticValue => {
  const next = cell.next;
  if (next === null) return cell.current;
  if (cell.pendingPresence === undefined) return next;
  return mapValue(cell.pendingPresence, (presence) =>
    presence.kind === "primitive" && typeof presence.value === "boolean"
      ? presence.value
        ? next
        : cell.current
      : unknownValue("state update has unresolved eligibility"),
  );
};

/**
 * The value the next pass commits: an escaped cell takes every value it may
 * hold; a cell with deferred updates holds the synchronous state or any value
 * a continuation of unknown timing may have set by the commit.
 */
const pendingStateValue = (cell: StateCell): StaticValue | null => {
  if (cell.isEscaped) return escapedStateValue(cell);
  const next = cell.next === null ? null : getQueuedState(cell);
  if (cell.deferred.length === 0) return next;
  return branchValue(
    [next ?? cell.current, ...cell.deferred],
    "state set by a continuation that may run after the commit",
    null,
    0,
    getStatePredicate(cell, cell.name),
  );
};

/**
 * An unchanged update queued outside render stays pending for a later rebase
 * without requesting a render. An escaped cell already commits to every value
 * it may take, so further updates cannot change it either. An update
 * queued by a continuation whose timing is unknown is kept as one more value
 * the cell may hold rather than the value it holds.
 */
export const queueStateUpdate = (
  frame: HookFrame,
  cell: StateCell,
  value: StaticValue,
  isDeferred: boolean,
): void => {
  if (cell.isEscaped) return;
  if (isDeferred) {
    if (cell.deferred.some((deferred) => isSameHookValue(deferred, value))) return;
    frame.recordUpdate?.(cell);
    cell.deferred.push(value);
  } else {
    if (isSameHookValue(value, getQueuedState(cell))) {
      if (!frame.isRendering) {
        if (
          cell.next === null ||
          (cell.pendingPresence !== undefined && getTruthiness(cell.pendingPresence) !== true)
        ) {
          frame.recordUpdate?.(cell);
          cell.next = value;
          cell.pendingPresence = TRUE_VALUE;
        } else if (!isSameHookValue(value, cell.current)) frame.recordUpdateCause?.();
      }
      return;
    }
    frame.recordUpdate?.(cell);
    cell.next = value;
    cell.pendingPresence = TRUE_VALUE;
  }
  if (!frame.isRendering) frame.requestRender?.();
};

export const queueReducerAction = (
  frame: HookFrame,
  cell: StateCell,
  action: StaticValue,
  isDeferred: boolean,
): void => {
  if (cell.isEscaped || frame.isFrozen) return;
  if (isDeferred) {
    escapeStateCell(frame, cell, null);
    return;
  }
  frame.recordUpdate?.(cell);
  if (frame.isRendering) frame.hasRenderPhaseReducerUpdate = true;
  cell.pendingReducerActions = mapValue(cell.pendingReducerActions ?? listValue([]), (pending) =>
    pending.kind === "list"
      ? listValue([...pending.items, action])
      : pending.kind === "unknown"
        ? pending
        : unknownValue("reducer action queue is not a known sequence"),
  );
  if (!frame.isRendering) frame.requestRender?.();
};

export const applyReducerState = (frame: HookFrame, cell: StateCell, value: StaticValue): void => {
  frame.didStateChange ||= !isSameHookValue(cell.current, value);
  cell.current = value;
};

/**
 * A setter handed to code the analysis does not follow may fire at any time: a
 * known `value` it sets is one more the cell may hold by the commit, an unknown
 * one makes the cell commit to every value it may take.
 */
export const escapeStateCell = (
  frame: HookFrame,
  cell: StateCell,
  value: StaticValue | null,
): void => {
  if (value) {
    queueStateUpdate(frame, cell, value, true);
    return;
  }
  if (cell.isEscaped) return;
  frame.recordUpdate?.(cell);
  cell.isEscaped = true;
  if (isSameHookValue(escapedStateValue(cell), cell.current)) return;
  if (!frame.isRendering) frame.requestRender?.();
};

const MAX_ESCAPED_REDUCER_STATES = 16;

/**
 * `dispatchReducerAction` with a known action from code the analysis does not
 * follow: the reducer runs on a later render against whatever the cell holds by
 * then, and the code may dispatch again, so the cell may hold any value the
 * reducer reaches from the values it may already hold. A reducer that keeps
 * producing new values, or one the analysis cannot follow, escapes the cell.
 */
export const escapeReducerDispatch = (
  frame: HookFrame,
  cell: StateCell,
  reduce: (state: StaticValue) => StaticValue,
): void => {
  if (cell.isEscaped) return;
  const held = [cell.current, ...(cell.next ? [getQueuedState(cell)] : []), ...cell.deferred];
  const reachable = [...held];
  for (let index = 0; index < reachable.length; index += 1) {
    const next = reduce(reachable[index]);
    if (next.kind === "unknown" || reachable.length > MAX_ESCAPED_REDUCER_STATES) {
      escapeStateCell(frame, cell, null);
      return;
    }
    if (!reachable.some((state) => isSameHookValue(state, next))) reachable.push(next);
  }
  for (const state of reachable.slice(held.length)) escapeStateCell(frame, cell, state);
};

/** `processUpdateQueue` for one cell: true when its committed value changed. */
export const applyPendingState = (cell: StateCell, isFrozen = false): boolean => {
  const next = pendingStateValue(cell);
  cell.next = null;
  cell.pendingPresence = undefined;
  if (next === null || isFrozen || isSameHookValue(next, cell.current)) return false;
  cell.current = next;
  return true;
};

/** Applies eager updates and returns cells with changed values or reducer work. */
export const commitHookPass = (frame: HookFrame): StateCell[] => {
  if (!frame.isRendering) frame.recordIncomingUpdates?.();
  const hasReducerWork = !frame.isRendering || frame.hasRenderPhaseReducerUpdate;
  frame.isRendering = false;
  frame.didStateChange = false;
  return frame.cells.filter((cell) => {
    const didChange = applyPendingState(cell, frame.isFrozen);
    frame.didStateChange ||= didChange;
    if (frame.isFrozen) cell.pendingReducerActions = null;
    return didChange || (hasReducerWork && cell.pendingReducerActions !== null);
  });
};

export const giveUpOnHookPass = (frame: HookFrame, cells: StateCell[]): void => {
  frame.isFrozen = true;
  for (const cell of cells) cell.current = unknownValue(`${cell.name} keeps updating after mount`);
};

export const areDepsEqual = (left: StaticValue | null, right: StaticValue | null): boolean =>
  left !== null &&
  right !== null &&
  left.kind === "list" &&
  right.kind === "list" &&
  left.items.length === right.items.length &&
  left.items.every((item, index) => isSameHookValue(item, right.items[index]));

const CALLABLE_CLEANUP_KINDS = new Set<StaticValue["kind"]>([
  "function",
  "native-function",
  "branch",
  "unknown",
]);

const runCleanup = (cleanup: StaticValue | null | undefined, call: EffectCall): void => {
  if (cleanup && CALLABLE_CLEANUP_KINDS.has(cleanup.kind)) call(cleanup);
};

export const mountEffect = (effect: EffectRecord, call: EffectCall): (() => void) => {
  const cleanup = call(effect.callback);
  return () => runCleanup(cleanup, call);
};

export const runChangedEffects = (
  effects: readonly EffectRecord[],
  previousEffects: readonly EffectRecord[],
  isLayout: boolean,
  call: EffectCall,
): void => {
  const changed: EffectRecord[] = [];
  effects.forEach((effect, index) => {
    if (effect.isLayout !== isLayout) return;
    const previous = previousEffects[index];
    if (previous && areDepsEqual(effect.deps, previous.deps)) {
      effect.cleanup = previous.cleanup;
      return;
    }
    runCleanup(previous?.cleanup, call);
    changed.push(effect);
  });
  for (const effect of changed) effect.cleanup = call(effect.callback);
};

/** `reappearLayoutEffects`/`reconnectPassiveEffects`: every effect of the phase mounts again. */
export const mountAllEffects = (
  effects: readonly EffectRecord[],
  isLayout: boolean,
  call: EffectCall,
): void => {
  for (const effect of effects) {
    if (effect.isLayout === isLayout) effect.cleanup = call(effect.callback);
  }
};

/** `disappearLayoutEffects`/`disconnectPassiveEffects` and deletion: every cleanup of the phase runs. */
export const unmountAllEffects = (
  effects: readonly EffectRecord[],
  isLayout: boolean,
  call: EffectCall,
): void => {
  for (const effect of effects) {
    if (effect.isLayout !== isLayout) continue;
    runCleanup(effect.cleanup, call);
    effect.cleanup = null;
  }
};
