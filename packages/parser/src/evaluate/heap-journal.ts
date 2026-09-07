import type {
  SourceLocation,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import { branchValue, joinObjectEntries } from "./values.js";

export type MutableHeapValue = StaticObjectValue | StaticListValue;

interface HeapPath {
  objects: Map<StaticObjectValue, StaticObjectEntry[]>;
  lists: Map<StaticListValue, StaticValue[]>;
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
 * lists reached through them live on the heap and would keep the mutations of
 * whichever path ran last. The journal snapshots every pre-existing value a
 * path mutates so the next path starts from the fork's entry state, and the
 * join leaves each mutated value with one alternative per path.
 */
export class HeapJournal {
  private readonly objects = new Map<StaticObjectValue, StaticObjectEntry[]>();
  private readonly lists = new Map<StaticListValue, StaticValue[]>();
  private readonly paths: HeapPath[] = [];

  constructor(readonly entryEpoch: number) {}

  record(target: MutableHeapValue): void {
    if (target.kind === "object") {
      if (!this.objects.has(target)) this.objects.set(target, [...target.entries]);
    } else if (!this.lists.has(target)) {
      this.lists.set(target, [...target.items]);
    }
  }

  endPath(): void {
    const path: HeapPath = { objects: new Map(), lists: new Map() };
    for (const [object, original] of this.objects) {
      path.objects.set(object, object.entries);
      object.entries = [...original];
    }
    for (const [list, original] of this.lists) {
      path.lists.set(list, list.items);
      list.items = [...original];
    }
    this.paths.push(path);
  }

  join(reason: string, location: SourceLocation | null, preferredPath: number): void {
    for (const [object, original] of this.objects) {
      const pathEntries = this.paths.map((path) => path.objects.get(object) ?? original);
      if (isUnchanged(pathEntries, original)) continue;
      object.entries =
        getAgreedState(pathEntries) ??
        joinObjectEntries(original, pathEntries, reason, location, preferredPath);
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
