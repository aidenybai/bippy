import type {
  JournaledState,
  SourceLocation,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import type { StateCell } from "./hooks.js";
import {
  UNDEFINED_VALUE,
  branchValue,
  getAllocationCount,
  getItemValue,
  isIndefiniteItem,
  isSameValue,
  joinObjectEntries,
  listValue,
  spreadListItems,
  unknownValue,
} from "./values.js";

export type MutableHeapValue = StaticObjectValue | StaticListValue;

export const IN_PROGRESS = Symbol("in-progress");

/** A module's evaluated top-level bindings, filled lazily and reassigned by `name = value`. */
export type ModuleValues = Map<string, StaticValue | typeof IN_PROGRESS>;

type ModuleBindingStates = Map<ModuleValues, Map<string, StaticValue>>;

/** A hook cell's pending update; null when none is queued. */
interface PendingHookUpdate {
  next: StaticValue | null;
  actions: StaticValue | null;
}

type PendingUpdates = Map<StateCell, PendingHookUpdate>;

const captureHookUpdate = (cell: StateCell): PendingHookUpdate => ({
  next: cell.next,
  actions: cell.pendingReducerActions,
});

const restoreHookUpdate = (cell: StateCell, update: PendingHookUpdate): void => {
  cell.next = update.next;
  cell.pendingReducerActions = update.actions;
};

interface ListState {
  items: StaticValue[];
  properties: Map<string, StaticValue> | undefined;
  nonEnumerableKeys: Set<string> | undefined;
}

interface HeapPath {
  objects: Map<StaticObjectValue, StaticObjectEntry[]>;
  lists: Map<StaticListValue, ListState>;
  states: Map<JournaledState<unknown>, unknown>;
  bindings: ModuleBindingStates;
  updates: PendingUpdates;
}

type IsSameItem<Item> = (left: Item, right: Item) => boolean;

const isSameReference = <Item>(left: Item, right: Item): boolean => left === right;

const copyListState = (list: StaticListValue): ListState => ({
  items: [...list.items],
  properties: list.properties && new Map(list.properties),
  nonEnumerableKeys: list.nonEnumerableKeys && new Set(list.nonEnumerableKeys),
});

const restoreListState = (list: StaticListValue, state: ListState): void => {
  list.items = [...state.items];
  list.properties = state.properties && new Map(state.properties);
  list.nonEnumerableKeys = state.nonEnumerableKeys && new Set(state.nonEnumerableKeys);
};

const joinListProperties = (
  pathProperties: (Map<string, StaticValue> | undefined)[],
  reason: string,
  location: SourceLocation | null,
  preferredPath: number,
): Map<string, StaticValue> | undefined => {
  const names = new Set(pathProperties.flatMap((properties) => [...(properties?.keys() ?? [])]));
  if (names.size === 0) return undefined;
  const joined = new Map<string, StaticValue>();
  for (const name of names) {
    const pathValues = pathProperties.map((properties) => properties?.get(name) ?? UNDEFINED_VALUE);
    joined.set(
      name,
      pathValues.every((value) => value === pathValues[0])
        ? pathValues[0]
        : branchValue(pathValues, reason, location, preferredPath),
    );
  }
  return joined;
};

const isExtensionOf = <Item>(
  items: Item[],
  prefix: Item[],
  isSameItem: IsSameItem<Item> = isSameReference,
): boolean =>
  items.length >= prefix.length &&
  prefix.every((item, index) => {
    const candidate = items[index];
    return candidate !== undefined && isSameItem(candidate, item);
  });

const isSameState = <Item>(
  items: Item[],
  other: Item[],
  isSameItem: IsSameItem<Item> = isSameReference,
): boolean => items.length === other.length && isExtensionOf(items, other, isSameItem);

const isUnchanged = <Item>(paths: Item[][], original: Item[]): boolean =>
  paths.every((items) => isSameState(items, original));

/** The state every path left, when the paths agree on it. */
const getAgreedState = <Item>(
  paths: Item[][],
  isSameItem: IsSameItem<Item> = isSameReference,
): Item[] | null => {
  const [first] = paths;
  return first !== undefined && paths.every((items) => isSameState(items, first, isSameItem))
    ? first
    : null;
};

/**
 * Scope bindings are restored and joined around every fork, but objects and
 * lists reached through them live on the heap, and module-level variables in
 * their module's value table, so both would keep the mutations of whichever
 * path ran last. The journal snapshots every pre-existing value a path mutates
 * so the next path starts from the fork's entry state, and the join leaves
 * each mutated value with one alternative per path. Values allocated after the
 * fork began exist on one path only and are left alone. A hook state update
 * queued on one path is pending on that path only: the join leaves the cell
 * with the update on the paths that queued one and its current value elsewhere.
 */
export class HeapJournal {
  private readonly objects = new Map<StaticObjectValue, StaticObjectEntry[]>();
  private readonly lists = new Map<StaticListValue, ListState>();
  private readonly states = new Map<JournaledState<unknown>, unknown>();
  private readonly bindings: ModuleBindingStates = new Map();
  private readonly updates: PendingUpdates = new Map();
  private paths: HeapPath[] = [];
  private readonly entryAllocation = getAllocationCount();

  constructor(private readonly unconditionalUpdates?: ReadonlySet<StateCell>) {}

  /** Whether `target` predates the fork, so its mutations must be journaled. */
  isPreexisting(target: MutableHeapValue | JournaledState<unknown>): boolean {
    return (target.allocation ?? 0) <= this.entryAllocation;
  }

  record(target: MutableHeapValue): void {
    if (target.kind === "object") {
      if (!this.objects.has(target)) this.objects.set(target, [...target.entries]);
    } else if (!this.lists.has(target)) {
      this.lists.set(target, copyListState(target));
    }
  }

  recordState(state: JournaledState<unknown>): void {
    if (!this.states.has(state)) this.states.set(state, state.capture());
  }

  recordModuleBinding(values: ModuleValues, name: string, current: StaticValue): void {
    let originals = this.bindings.get(values);
    if (!originals) {
      originals = new Map();
      this.bindings.set(values, originals);
    }
    if (!originals.has(name)) originals.set(name, current);
  }

  recordStateUpdate(cell: StateCell): void {
    if (this.unconditionalUpdates?.has(cell)) return;
    if (!this.updates.has(cell)) this.updates.set(cell, captureHookUpdate(cell));
  }

  endPath(): void {
    const path: HeapPath = {
      objects: new Map(),
      lists: new Map(),
      states: new Map(),
      bindings: new Map(),
      updates: new Map(),
    };
    for (const [object, original] of this.objects) {
      path.objects.set(object, object.entries);
      object.entries = [...original];
    }
    for (const [list, original] of this.lists) {
      path.lists.set(list, {
        items: list.items,
        properties: list.properties,
        nonEnumerableKeys: list.nonEnumerableKeys,
      });
      restoreListState(list, original);
    }
    for (const [state, original] of this.states) {
      path.states.set(state, state.capture());
      state.restore(original);
    }
    for (const [values, originals] of this.bindings) {
      const pathValues = new Map<string, StaticValue>();
      for (const [name, original] of originals) {
        const current = values.get(name);
        pathValues.set(name, current === undefined || current === IN_PROGRESS ? original : current);
        values.set(name, original);
      }
      path.bindings.set(values, pathValues);
    }
    for (const [cell, original] of this.updates) {
      path.updates.set(cell, captureHookUpdate(cell));
      restoreHookUpdate(cell, original);
    }
    this.paths.push(path);
  }

  /** `mayRepeat`: the ran path stands for any number of runs (a loop body), not at most one. */
  join(
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
    isRepeated = false,
  ): void {
    this.applyJoin(this.paths, reason, location, preferredPath, predicate, isRepeated);
  }

  /**
   * The code after a fork runs once for every path that completes, so those
   * paths collapse into the live state it starts from and end again as one
   * path once it has run; the paths that jumped away stay separate.
   */
  continueFrom(
    indices: number[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
  ): void {
    const selected = indices.map((index) => this.paths[index]);
    this.paths = this.paths.filter((_, index) => !indices.includes(index));
    this.applyJoin(selected, reason, location, preferredPath, predicate, false);
  }

  private applyJoin(
    paths: HeapPath[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
    isRepeated: boolean,
  ): void {
    for (const [cell, original] of this.updates) {
      const pathUpdates = paths.map((path) => path.updates.get(cell) ?? original);
      const nextValues = pathUpdates.map((update) => update.next);
      cell.next = nextValues.every((value) => value === nextValues[0])
        ? nextValues[0]
        : branchValue(
            nextValues.map((value) => value ?? cell.current),
            reason,
            location,
            preferredPath,
            predicate,
          );
      const actionQueues = pathUpdates.map((update) => update.actions);
      cell.pendingReducerActions = actionQueues.every((value) => value === actionQueues[0])
        ? actionQueues[0]
        : isRepeated
          ? unknownValue("reducer dispatch count is not bounded", location)
          : branchValue(
              actionQueues.map((value) => value ?? listValue([])),
              reason,
              location,
              preferredPath,
              predicate,
            );
    }
    for (const [values, originals] of this.bindings) {
      for (const [name, original] of originals) {
        const pathValues = paths.map((path) => path.bindings.get(values)?.get(name) ?? original);
        values.set(
          name,
          pathValues.every((value) => value === pathValues[0])
            ? pathValues[0]
            : branchValue(pathValues, reason, location, preferredPath, predicate),
        );
      }
    }
    for (const [object, original] of this.objects) {
      const pathEntries = paths.map((path) => path.objects.get(object) ?? original);
      if (isUnchanged(pathEntries, original)) continue;
      object.entries =
        getAgreedState(pathEntries) ??
        joinObjectEntries(original, pathEntries, reason, location, preferredPath, predicate);
    }
    for (const [state, original] of this.states) {
      state.join(
        paths.map((path) => (path.states.has(state) ? path.states.get(state) : original)),
        reason,
        location,
        preferredPath,
        predicate,
      );
    }
    for (const [list, original] of this.lists) {
      const pathStates = paths.map((path) => path.lists.get(list) ?? original);
      list.properties = joinListProperties(
        pathStates.map((state) => state.properties),
        reason,
        location,
        preferredPath,
      );
      const nonEnumerableKeys = pathStates.flatMap((state) => [...(state.nonEnumerableKeys ?? [])]);
      list.nonEnumerableKeys =
        nonEnumerableKeys.length > 0 ? new Set(nonEnumerableKeys) : undefined;
      const pathItems = pathStates.map((state) => state.items);
      if (isUnchanged(pathItems, original.items)) continue;
      const agreedItems = getAgreedState(pathItems, isSameValue);
      if (agreedItems) {
        list.items = agreedItems;
        continue;
      }
      const isEveryPathAppending = pathItems.every((items) => isExtensionOf(items, original.items));
      const appendedItems = pathItems.map((items) => items.slice(original.items.length));
      if (isEveryPathAppending && !isRepeated && !appendedItems.flat().some(isIndefiniteItem)) {
        list.items = [
          ...original.items,
          ...spreadListItems(
            branchValue(appendedItems.map(listValue), reason, location, preferredPath, predicate),
            location,
          ),
        ];
        continue;
      }
      if (!isRepeated && pathItems.every((items) => !items.some(isIndefiniteItem))) {
        list.items = spreadListItems(
          branchValue(pathItems.map(listValue), reason, location, preferredPath, predicate),
          location,
        );
        continue;
      }
      const uncertainItems = (isEveryPathAppending ? appendedItems : pathItems)
        .flat()
        .map(getItemValue);
      list.items = isEveryPathAppending ? [...original.items] : [];
      if (uncertainItems.length > 0)
        appendRepeatedItems(list.items, uncertainItems, reason, location);
    }
  }
}

/**
 * Appends items present any number of times over. A trailing repeat absorbs
 * them, so a loop appending on every iteration does not grow the list by one
 * repeat per iteration it is unrolled for.
 */
const appendRepeatedItems = (
  items: StaticValue[],
  appended: StaticValue[],
  reason: string,
  location: SourceLocation | null,
): void => {
  const last = items[items.length - 1];
  if (last?.kind === "repeat") {
    items[items.length - 1] = {
      ...last,
      item: branchValue([last.item, ...appended], reason, location),
    };
    return;
  }
  items.push({ kind: "repeat", item: branchValue(appended, reason, location), location });
};
