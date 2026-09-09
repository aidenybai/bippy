import type { StaticNativeFunctionValue, StaticValue } from "../types.js";
import { getStatePredicate } from "./predicates.js";
import { areValuesEquivalent, branchValue, compareIdentity, unknownValue } from "./values.js";

export interface StateCell {
  name: string;
  initial: StaticValue;
  current: StaticValue;
  next: StaticValue | null;
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
  previousEffects: EffectRecord[];
  isRendering: boolean;
  isDeferred: boolean;
  isFrozen: boolean;
  doublesHookFactories: boolean;
  requestRender: (() => void) | null;
  recordUpdate: ((cell: StateCell) => void) | null;
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
  previousEffects: [],
  isRendering: false,
  isDeferred: false,
  isFrozen: false,
  doublesHookFactories,
  requestRender: null,
  recordUpdate,
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
  frame.isRendering = true;
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
export const isSameHookValue = (left: StaticValue, right: StaticValue): boolean =>
  compareIdentity(left, right) ?? areValuesEquivalent(left, right);

const escapedStateValue = (cell: StateCell): StaticValue =>
  branchValue(
    [cell.initial, unknownValue(`updated state of ${cell.name}`)],
    "state setter escapes to code that is not evaluated",
    null,
    0,
    getStatePredicate(cell, cell.name),
  );

/**
 * The value the next pass commits: an escaped cell takes every value it may
 * hold; a cell with deferred updates holds the synchronous state or any value
 * a continuation of unknown timing may have set by the commit.
 */
const pendingStateValue = (cell: StateCell): StaticValue | null => {
  if (cell.isEscaped) return escapedStateValue(cell);
  if (cell.deferred.length === 0) return cell.next;
  return branchValue(
    [cell.next ?? cell.current, ...cell.deferred],
    "state set by a continuation that may run after the commit",
    null,
    0,
    getStatePredicate(cell, cell.name),
  );
};

/**
 * Mirrors `dispatchSetState`: an update that leaves the value the cell will
 * commit unchanged is dropped eagerly. An escaped cell already commits to every
 * value it may take, so further updates cannot change it either. An update
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
    cell.deferred.push(value);
  } else {
    if (isSameHookValue(value, cell.next ?? cell.current)) return;
    frame.recordUpdate?.(cell);
    cell.next = value;
  }
  if (!frame.isRendering) frame.requestRender?.();
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
  cell.isEscaped = true;
  if (isSameHookValue(escapedStateValue(cell), cell.current)) return;
  if (!frame.isRendering) frame.requestRender?.();
};

/** `processUpdateQueue` for one cell: true when its committed value changed. */
export const applyPendingState = (cell: StateCell, isFrozen = false): boolean => {
  const next = pendingStateValue(cell);
  cell.next = null;
  if (next === null || isFrozen || isSameHookValue(next, cell.current)) return false;
  cell.current = next;
  return true;
};

/** Applies the queued updates and returns the cells whose value changed. */
export const commitHookPass = (frame: HookFrame): StateCell[] => {
  frame.isRendering = false;
  return frame.cells.filter((cell) => applyPendingState(cell, frame.isFrozen));
};

export const giveUpOnHookPass = (frame: HookFrame, cells: StateCell[]): void => {
  frame.isFrozen = true;
  for (const cell of cells) cell.current = unknownValue(`${cell.name} keeps updating after mount`);
};

const areDepsEqual = (left: StaticValue | null, right: StaticValue | null): boolean =>
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

/** `commitHookEffectListUnmount` for one effect; React only warns about a non-function return. */
const runCleanup = (effect: EffectRecord | undefined, call: EffectCall): void => {
  if (effect?.cleanup && CALLABLE_CLEANUP_KINDS.has(effect.cleanup.kind)) call(effect.cleanup);
};

/**
 * The commit's effects of one phase: those whose dependency list changed since
 * the last commit clean up and run again, the others keep their cleanup, as
 * `updateEffectImpl` decides. Cleanups run before any effect, as React unmounts
 * the whole phase before mounting it.
 */
export const runChangedEffects = (frame: HookFrame, isLayout: boolean, call: EffectCall): void => {
  const changed: EffectRecord[] = [];
  frame.effects.forEach((effect, index) => {
    if (effect.isLayout !== isLayout) return;
    const previous = frame.previousEffects[index];
    if (previous && areDepsEqual(effect.deps, previous.deps)) {
      effect.cleanup = previous.cleanup;
      return;
    }
    runCleanup(previous, call);
    changed.push(effect);
  });
  for (const effect of changed) effect.cleanup = call(effect.callback);
};

/** `reappearLayoutEffects`/`reconnectPassiveEffects`: every effect of the phase mounts again. */
export const mountAllEffects = (frame: HookFrame, isLayout: boolean, call: EffectCall): void => {
  for (const effect of frame.effects) {
    if (effect.isLayout === isLayout) effect.cleanup = call(effect.callback);
  }
};

/** `disappearLayoutEffects`/`disconnectPassiveEffects` and deletion: every cleanup of the phase runs. */
export const unmountAllEffects = (frame: HookFrame, isLayout: boolean, call: EffectCall): void => {
  for (const effect of frame.effects) {
    if (effect.isLayout !== isLayout) continue;
    runCleanup(effect, call);
    effect.cleanup = null;
  }
};

/** The effects of the pass that reached the commit become the baseline later passes diff against. */
export const commitEffects = (frame: HookFrame): void => {
  frame.previousEffects = frame.effects;
};
