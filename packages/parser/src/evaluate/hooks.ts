import type { StaticNativeFunctionValue, StaticValue } from "../types.js";
import { areValuesEquivalent, branchValue, unknownValue } from "./values.js";

export interface StateCell {
  name: string;
  initial: StaticValue;
  current: StaticValue;
  next: StaticValue | null;
  setter: StaticNativeFunctionValue | null;
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
 * still produce a pass.
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
  requestRender: (() => void) | null;
}

export const createHookFrame = (): HookFrame => ({
  cells: [],
  cursor: 0,
  memoCells: [],
  memoCursor: 0,
  effects: [],
  previousEffects: [],
  isRendering: false,
  isDeferred: false,
  isFrozen: false,
  requestRender: null,
});

export const beginHookPass = (frame: HookFrame): void => {
  frame.previousEffects = frame.effects;
  restartHookPass(frame);
};

/** A render-phase update re-runs the body against the same committed effects, as `renderWithHooksAgain` does. */
export const restartHookPass = (frame: HookFrame): void => {
  frame.cursor = 0;
  frame.memoCursor = 0;
  frame.effects = [];
  frame.isRendering = true;
};

export const nextStateCell = (frame: HookFrame, name: string, initial: StaticValue): StateCell => {
  const index = frame.cursor++;
  const existing = frame.cells[index];
  if (existing) return existing;
  const cell: StateCell = {
    name,
    initial,
    current: initial,
    next: null,
    setter: null,
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

/** Mirrors `dispatchSetState`: with nothing pending, an update that leaves the cell unchanged is dropped eagerly. */
export const queueStateUpdate = (frame: HookFrame, cell: StateCell, value: StaticValue): void => {
  if (frame.isDeferred) {
    cell.isEscaped = true;
  } else {
    if (cell.next === null && areValuesEquivalent(value, cell.current)) return;
    cell.next = value;
  }
  if (!frame.isRendering) frame.requestRender?.();
};

export const escapedStateValue = (cell: StateCell): StaticValue =>
  branchValue(
    [cell.initial, unknownValue(`updated state of ${cell.name}`)],
    "state setter escapes to code that is not evaluated",
    null,
  );

/** `processUpdateQueue` for one cell: true when its committed value changed. */
export const applyPendingState = (cell: StateCell, isFrozen = false): boolean => {
  const next = cell.isEscaped ? escapedStateValue(cell) : cell.next;
  cell.next = null;
  if (next === null || isFrozen || areValuesEquivalent(next, cell.current)) return false;
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
  left.items.every((item, index) => areValuesEquivalent(item, right.items[index]));

/** Effects whose dependency list is unchanged from the previous pass are skipped, as in `updateEffectImpl`. */
export const effectsToRun = (frame: HookFrame): EffectRecord[] =>
  frame.effects.filter(
    (effect, index) => !areDepsEqual(effect.deps, frame.previousEffects[index]?.deps ?? null),
  );
