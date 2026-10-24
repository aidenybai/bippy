import type { BindingPlace } from "../types";
import { getPlaceKey } from "./get-place-key";

const formatPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  [bindingId, ...path].join(".");

export class PlaceMap<Value> {
  #entries = new Map<string, [BindingPlace, Value]>();
  #isShared = false;

  constructor(entries: Iterable<[BindingPlace, Value]> = []) {
    for (const [place, value] of entries) this.set(place, value);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(place: BindingPlace): Value | undefined {
    return this.#entries.get(getPlaceKey(place))?.[1];
  }

  has(place: BindingPlace): boolean {
    return this.#entries.has(getPlaceKey(place));
  }

  set(place: BindingPlace, value: Value): this {
    this.#ownEntries().set(getPlaceKey(place), [place, value]);
    return this;
  }

  delete(place: BindingPlace): boolean {
    const key = getPlaceKey(place);
    return this.#entries.has(key) && this.#ownEntries().delete(key);
  }

  clone(): PlaceMap<Value> {
    const copy = new PlaceMap<Value>();
    copy.#entries = this.#entries;
    copy.#isShared = true;
    this.#isShared = true;
    return copy;
  }

  intersect(
    other: PlaceMap<Value>,
    join: (place: BindingPlace, value: Value, otherValue: Value) => Value,
  ): PlaceMap<Value> {
    const joined = this.clone();
    for (const [key, [place, value]] of this.#entries) {
      const otherEntry = other.#entries.get(key);
      if (!otherEntry) joined.#ownEntries().delete(key);
      if (otherEntry && otherEntry[1] !== value)
        joined.#ownEntries().set(key, [place, join(place, value, otherEntry[1])]);
    }
    return joined;
  }

  places(): BindingPlace[] {
    return [...this.#entries.values()].map(([place]) => place);
  }

  values(): Value[] {
    return [...this.#entries.values()].map(([, value]) => value);
  }

  [Symbol.iterator](): IterableIterator<[BindingPlace, Value]> {
    return this.#entries.values();
  }

  toJSON(): Record<string, Value> {
    return Object.fromEntries([...this].map(([place, value]) => [formatPlaceKey(place), value]));
  }

  #ownEntries(): Map<string, [BindingPlace, Value]> {
    if (this.#isShared) {
      this.#entries = new Map(this.#entries);
      this.#isShared = false;
    }
    return this.#entries;
  }
}
