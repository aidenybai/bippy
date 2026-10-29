import type { BindingPlace } from "../types";
import { getPlaceKey } from "./get-place-key";

type Entry<Value> = [BindingPlace, Value];

interface Change<Value> {
  entry: Entry<Value> | null;
  isMoved: boolean;
}

const MAX_CHANGES = 16;

const formatPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  [bindingId, ...path].join(".");

export class PlaceMap<Value> {
  #base = new Map<string, Entry<Value>>();
  #changes = new Map<string, Change<Value>>();
  #isBaseShared = false;
  #isChangesShared = false;
  #size = 0;

  constructor(entries: Iterable<[BindingPlace, Value]> = []) {
    for (const [place, value] of entries) this.set(place, value);
  }

  get size(): number {
    return this.#size;
  }

  get(place: BindingPlace): Value | undefined {
    return this.#getEntry(getPlaceKey(place))?.[1];
  }

  has(place: BindingPlace): boolean {
    return this.#getEntry(getPlaceKey(place)) !== undefined;
  }

  set(place: BindingPlace, value: Value): this {
    if (this.#changes.size > MAX_CHANGES) this.#flatten();
    const key = getPlaceKey(place);
    const entry: Entry<Value> = [place, value];
    if (this.#changes.size === 0 && !this.#isBaseShared) {
      if (!this.#base.has(key)) this.#size++;
      this.#base.set(key, entry);
      return this;
    }
    const change = this.#changes.get(key);
    const isInBase = this.#base.has(key);
    const isPresent = change ? change.entry !== null : isInBase;
    if (!isPresent) this.#size++;
    const changes = this.#ownChanges();
    if (change?.entry === null && isInBase) {
      changes.delete(key);
      changes.set(key, { entry, isMoved: true });
      return this;
    }
    changes.set(key, { entry, isMoved: change?.isMoved ?? false });
    return this;
  }

  delete(place: BindingPlace): boolean {
    const key = getPlaceKey(place);
    if (this.#getEntry(key) === undefined) return false;
    if (this.#changes.size > MAX_CHANGES) this.#flatten();
    this.#size--;
    if (this.#changes.size === 0 && !this.#isBaseShared) return this.#base.delete(key);
    const changes = this.#ownChanges();
    changes.delete(key);
    if (this.#base.has(key)) changes.set(key, { entry: null, isMoved: false });
    return true;
  }

  clone(): PlaceMap<Value> {
    const copy = new PlaceMap<Value>();
    copy.#base = this.#base;
    copy.#changes = this.#changes;
    copy.#size = this.#size;
    copy.#isBaseShared = true;
    copy.#isChangesShared = true;
    this.#isBaseShared = true;
    this.#isChangesShared = true;
    return copy;
  }

  intersect(
    other: PlaceMap<Value>,
    join: (place: BindingPlace, value: Value, otherValue: Value) => Value,
  ): PlaceMap<Value> {
    const joined = this.clone();
    if (this.#base === other.#base && this.#changes === other.#changes) return joined;
    for (const [place, value] of this) {
      const key = getPlaceKey(place);
      const otherEntry = other.#getEntry(key);
      if (!otherEntry) joined.delete(place);
      if (otherEntry && otherEntry[1] !== value)
        joined.set(place, join(place, value, otherEntry[1]));
    }
    return joined;
  }

  entriesOf(bindingIds: ReadonlySet<number>): Entry<Value>[] {
    const entries: Entry<Value>[] = [];
    for (const [key, entry] of this.#base) {
      if (!bindingIds.has(entry[0].bindingId)) continue;
      const change = this.#changes.get(key);
      if (!change) entries.push(entry);
      else if (change.entry && !change.isMoved) entries.push(change.entry);
    }
    for (const [key, change] of this.#changes)
      if (
        change.entry &&
        bindingIds.has(change.entry[0].bindingId) &&
        (change.isMoved || !this.#base.has(key))
      )
        entries.push(change.entry);
    return entries;
  }

  placesOf(bindingIds: ReadonlySet<number>): BindingPlace[] {
    return this.entriesOf(bindingIds).map(([place]) => place);
  }

  places(): BindingPlace[] {
    return [...this].map(([place]) => place);
  }

  values(): Value[] {
    return [...this].map(([, value]) => value);
  }

  [Symbol.iterator](): IterableIterator<[BindingPlace, Value]> {
    if (this.#changes.size > 0) this.#flatten();
    return this.#base.values();
  }

  toJSON(): Record<string, Value> {
    return Object.fromEntries([...this].map(([place, value]) => [formatPlaceKey(place), value]));
  }

  #getEntry(key: string): Entry<Value> | undefined {
    const change = this.#changes.get(key);
    if (change) return change.entry ?? undefined;
    return this.#base.get(key);
  }

  #ownChanges(): Map<string, Change<Value>> {
    if (this.#isChangesShared) {
      this.#changes = new Map(this.#changes);
      this.#isChangesShared = false;
    }
    return this.#changes;
  }

  #flatten(): void {
    const base = new Map<string, Entry<Value>>();
    for (const [key, entry] of this.#base) {
      const change = this.#changes.get(key);
      if (!change) base.set(key, entry);
      else if (change.entry && !change.isMoved) base.set(key, change.entry);
    }
    for (const [key, change] of this.#changes)
      if (change.entry && (change.isMoved || !this.#base.has(key))) base.set(key, change.entry);
    this.#base = base;
    this.#changes = new Map();
    this.#isBaseShared = false;
    this.#isChangesShared = false;
  }
}
