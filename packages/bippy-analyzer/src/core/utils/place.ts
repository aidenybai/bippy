import type { Binding, BindingValue, Place } from "../types";

export const getPlaceKey = ({ bindingId, path }: Place): string =>
  JSON.stringify([bindingId, ...path]);

export const getBindingPlace = (binding: Binding, path: string[] = []): Place => ({
  bindingId: binding.id,
  path,
});

export const getValuePlace = (value: BindingValue): Place =>
  getBindingPlace(value.binding, value.path);

export const formatPlace = ({ bindingId, path }: Place): string => [bindingId, ...path].join(".");

export const isSamePlace = (left: Place, right: Place): boolean =>
  getPlaceKey(left) === getPlaceKey(right);

export const isPlacePrefix = (prefix: Place, place: Place): boolean =>
  prefix.bindingId === place.bindingId &&
  prefix.path.length <= place.path.length &&
  prefix.path.every((segment, index) => place.path[index] === segment);

/** A map keyed by place, so a field path is never encoded and parsed back. */
export class PlaceMap<Value> {
  readonly #entries = new Map<string, [Place, Value]>();

  constructor(entries: Iterable<[Place, Value]> = []) {
    for (const [place, value] of entries) this.set(place, value);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(place: Place): Value | undefined {
    return this.#entries.get(getPlaceKey(place))?.[1];
  }

  has(place: Place): boolean {
    return this.#entries.has(getPlaceKey(place));
  }

  set(place: Place, value: Value): this {
    this.#entries.set(getPlaceKey(place), [place, value]);
    return this;
  }

  places(): Place[] {
    return [...this.#entries.values()].map(([place]) => place);
  }

  values(): Value[] {
    return [...this.#entries.values()].map(([, value]) => value);
  }

  [Symbol.iterator](): IterableIterator<[Place, Value]> {
    return this.#entries.values();
  }

  toJSON(): Record<string, Value> {
    return Object.fromEntries([...this].map(([place, value]) => [formatPlace(place), value]));
  }
}
