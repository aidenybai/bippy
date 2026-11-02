import type { BindingPlace } from "../types";

const SEPARATOR = "\0";

const getPlaceKey = (place: BindingPlace): string =>
  place.path.length === 0
    ? `${place.bindingId}`
    : `${place.bindingId}${SEPARATOR}${place.path.join(SEPARATOR)}`;

const formatPlaceKey = (place: BindingPlace): string => [place.bindingId, ...place.path].join(".");

export class PlaceMap<Value> {
  #entries = new Map<string, [BindingPlace, Value]>();

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
    this.#entries.set(getPlaceKey(place), [place, value]);
    return this;
  }

  places(): BindingPlace[] {
    return [...this.#entries.values()].map((entry) => entry[0]);
  }

  values(): Value[] {
    return [...this.#entries.values()].map((entry) => entry[1]);
  }

  [Symbol.iterator](): IterableIterator<[BindingPlace, Value]> {
    return this.#entries.values();
  }

  toJSON(): Record<string, Value> {
    return Object.fromEntries([...this].map(([place, value]) => [formatPlaceKey(place), value]));
  }
}
