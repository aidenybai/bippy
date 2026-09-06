import type { Node } from "oxc-parser";
import type { FunctionLikeNode, StaticValue } from "../types.js";
import { forEachChildNode } from "../parse/ast-walk.js";
import { lookupScope } from "./scope.js";
import { areValuesEquivalent, branchValue, unknownValue } from "./values.js";

export interface StateCell {
  name: string;
  initial: StaticValue;
  current: StaticValue;
  next: StaticValue | null;
  isEscaped: boolean;
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
 */
export interface HookFrame {
  cells: StateCell[];
  cursor: number;
  effects: EffectRecord[];
  previousEffects: EffectRecord[];
  isRendering: boolean;
  isDeferred: boolean;
}

export const createHookFrame = (): HookFrame => ({
  cells: [],
  cursor: 0,
  effects: [],
  previousEffects: [],
  isRendering: false,
  isDeferred: false,
});

export const beginHookPass = (frame: HookFrame): void => {
  frame.cursor = 0;
  frame.previousEffects = frame.effects;
  frame.effects = [];
  frame.isRendering = true;
};

export const nextStateCell = (frame: HookFrame, name: string, initial: StaticValue): StateCell => {
  const index = frame.cursor++;
  const existing = frame.cells[index];
  if (existing) return existing;
  const cell: StateCell = { name, initial, current: initial, next: null, isEscaped: false };
  frame.cells[index] = cell;
  return cell;
};

export const queueStateUpdate = (frame: HookFrame, cell: StateCell, value: StaticValue): void => {
  if (frame.isDeferred) cell.isEscaped = true;
  else cell.next = value;
};

export const escapedStateValue = (cell: StateCell): StaticValue =>
  branchValue(
    [cell.initial, unknownValue(`updated state of ${cell.name}`)],
    "state setter escapes to code that is not evaluated",
    null,
  );

/**
 * Mirrors `dispatchSetState`'s eager bailout: a queued update only schedules
 * another pass when it changes its cell. Returns the cells that changed.
 */
export const commitHookPass = (frame: HookFrame): StateCell[] => {
  frame.isRendering = false;
  const changedCells: StateCell[] = [];
  for (const cell of frame.cells) {
    const next = cell.isEscaped ? escapedStateValue(cell) : cell.next;
    if (next !== null && !areValuesEquivalent(next, cell.current)) {
      cell.current = next;
      changedCells.push(cell);
    }
    cell.next = null;
  }
  return changedCells;
};

export const giveUpOnHookPass = (cells: StateCell[]): void => {
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

const MAX_ESCAPE_SCAN_DEPTH = 4;

const freeIdentifiersCache = new WeakMap<FunctionLikeNode, Set<string>>();

const collectIdentifiers = (node: Node, names: Set<string>): void => {
  if (node.type === "Identifier") {
    names.add(node.name);
    return;
  }
  if (node.type === "MemberExpression" && !node.computed) {
    collectIdentifiers(node.object, names);
    return;
  }
  if (node.type === "Property" && !node.computed && node.key.type === "Identifier") {
    collectIdentifiers(node.value, names);
    return;
  }
  forEachChildNode(node, (child) => collectIdentifiers(child, names));
};

const getFreeIdentifiers = (fn: FunctionLikeNode): Set<string> => {
  const cached = freeIdentifiersCache.get(fn);
  if (cached) return cached;
  const names = new Set<string>();
  collectIdentifiers(fn, names);
  freeIdentifiersCache.set(fn, names);
  return names;
};

/**
 * Marks state setters reachable from `value` as escaped: the value flows into
 * code the evaluator cannot follow, so the setter may run at any time after
 * mount. Closures are scanned for the setters they close over.
 */
export const markEscapedSetters = (
  value: StaticValue,
  visited: Set<StaticValue> = new Set(),
  depth = 0,
): void => {
  if (depth > MAX_ESCAPE_SCAN_DEPTH || visited.has(value)) return;
  visited.add(value);
  switch (value.kind) {
    case "native-function":
      value.onEscape?.();
      return;
    case "function":
      for (const name of getFreeIdentifiers(value.node)) {
        const bound = lookupScope(value.scope, name);
        if (bound) markEscapedSetters(bound, visited, depth + 1);
      }
      return;
    case "object":
      for (const entry of value.entries) markEscapedSetters(entry.value, visited, depth + 1);
      return;
    case "list":
      for (const item of value.items) markEscapedSetters(item, visited, depth + 1);
      return;
    case "branch":
      for (const alternative of value.alternatives)
        markEscapedSetters(alternative, visited, depth + 1);
      return;
    case "optional":
    case "repeat":
      markEscapedSetters(value.kind === "optional" ? value.value : value.item, visited, depth + 1);
      return;
    default:
      return;
  }
};
