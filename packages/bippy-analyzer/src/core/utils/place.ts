import type { Binding, BindingValue, BindingPlace } from "../types";

export const getPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  JSON.stringify([bindingId, ...path]);

export const getBindingPlace = (binding: Binding, path: string[] = []): BindingPlace => ({
  bindingId: binding.id,
  path,
});

export const getValuePlace = (value: BindingValue): BindingPlace =>
  getBindingPlace(value.binding, value.path);

export const formatPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  [bindingId, ...path].join(".");

export const isSamePlace = (left: BindingPlace, right: BindingPlace): boolean =>
  getPlaceKey(left) === getPlaceKey(right);

export const isPlacePrefix = (prefix: BindingPlace, place: BindingPlace): boolean =>
  prefix.bindingId === place.bindingId &&
  prefix.path.length <= place.path.length &&
  prefix.path.every((segment, index) => place.path[index] === segment);

export class PlaceMap<Value> {
  readonly #entries = new Map<string, [BindingPlace, Value]>();

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
}
