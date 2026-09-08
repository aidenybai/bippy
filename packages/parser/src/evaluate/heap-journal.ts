import type {
  SourceLocation,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { branchValue, getAllocationCount, joinObjectEntries } from "./values.js";

export type MutableHeapValue = StaticObjectValue | StaticListValue;

export const IN_PROGRESS = Symbol("in-progress");

/** A module's evaluated top-level bindings, filled lazily and reassigned by `name = value`. */
export type ModuleValues = Map<string, StaticValue | typeof IN_PROGRESS>;

type ModuleBindingStates = Map<ModuleValues, Map<string, StaticValue>>;

interface HeapPath {
  objects: Map<StaticObjectValue, StaticObjectEntry[]>;
  lists: Map<StaticListValue, StaticValue[]>;
  bindings: ModuleBindingStates;
}

const isExtensionOf = <Item>(items: Item[], prefix: Item[]): boolean =>
  items.length >= prefix.length && prefix.every((item, index) => items[index] === item);

const isSameState = <Item>(items: Item[], other: Item[]): boolean =>
  items.length === other.length && isExtensionOf(items, other);

const isUnchanged = <Item>(paths: Item[][], original: Item[]): boolean =>
  paths.every((items) => isSameState(items, original));

/** The state every path left, when the paths agree on it. */
const getAgreedState = <Item>(paths: Item[][]): Item[] | null =>
  paths.every((items) => isSameState(items, paths[0])) ? paths[0] : null;

/**
 * Scope bindings are restored and joined around every fork, but objects and
 * lists reached through them live on the heap, and module-level variables in
 * their module's value table, so both would keep the mutations of whichever
 * path ran last. The journal snapshots every pre-existing value a path mutates
 * so the next path starts from the fork's entry state, and the join leaves
 * each mutated value with one alternative per path. Values allocated after the
 * fork began exist on one path only and are left alone.
 */
export class HeapJournal {
  private readonly objects = new Map<StaticObjectValue, StaticObjectEntry[]>();
  private readonly lists = new Map<StaticListValue, StaticValue[]>();
  private readonly bindings: ModuleBindingStates = new Map();
  private readonly paths: HeapPath[] = [];
  private readonly entryAllocation = getAllocationCount();

  /** Whether `target` predates the fork, so its mutations must be journaled. */
  isPreexisting(target: MutableHeapValue): boolean {
    return (target.allocation ?? 0) <= this.entryAllocation;
  }

  record(target: MutableHeapValue): void {
    if (target.kind === "object") {
      if (!this.objects.has(target)) this.objects.set(target, [...target.entries]);
    } else if (!this.lists.has(target)) {
      this.lists.set(target, [...target.items]);
    }
  }

  recordModuleBinding(values: ModuleValues, name: string, current: StaticValue): void {
    let originals = this.bindings.get(values);
    if (!originals) {
      originals = new Map();
      this.bindings.set(values, originals);
    }
    if (!originals.has(name)) originals.set(name, current);
  }

  endPath(): void {
    const path: HeapPath = { objects: new Map(), lists: new Map(), bindings: new Map() };
    for (const [object, original] of this.objects) {
      path.objects.set(object, object.entries);
      object.entries = [...original];
    }
    for (const [list, original] of this.lists) {
      path.lists.set(list, list.items);
      list.items = [...original];
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
    this.paths.push(path);
  }

  join(
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
  ): void {
    for (const [values, originals] of this.bindings) {
      for (const [name, original] of originals) {
        const pathValues = this.paths.map(
          (path) => path.bindings.get(values)?.get(name) ?? original,
        );
        values.set(
          name,
          pathValues.every((value) => value === pathValues[0])
            ? pathValues[0]
            : branchValue(pathValues, reason, location, preferredPath, predicate),
        );
      }
    }
    for (const [object, original] of this.objects) {
      const pathEntries = this.paths.map((path) => path.objects.get(object) ?? original);
      if (isUnchanged(pathEntries, original)) continue;
      object.entries =
        getAgreedState(pathEntries) ??
        joinObjectEntries(original, pathEntries, reason, location, preferredPath, predicate);
    }
    for (const [list, original] of this.lists) {
      const pathItems = this.paths.map((path) => path.lists.get(list) ?? original);
      if (isUnchanged(pathItems, original)) continue;
      const agreedItems = getAgreedState(pathItems);
      if (agreedItems) {
        list.items = agreedItems;
        continue;
      }
      const isEveryPathAppending = pathItems.every((items) => isExtensionOf(items, original));
      const uncertainItems = isEveryPathAppending
        ? pathItems.flatMap((items) => items.slice(original.length))
        : pathItems.flat();
      list.items = isEveryPathAppending ? [...original] : [];
      if (uncertainItems.length > 0) {
        list.items.push({
          kind: "repeat",
          item: branchValue(uncertainItems, reason, location),
          location,
        });
      }
    }
  }
}
