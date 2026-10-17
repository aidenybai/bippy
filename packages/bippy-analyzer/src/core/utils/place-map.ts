import type { BindingPlace } from "../types";
import { getPlaceKey } from "./get-place-key";

const formatPlaceKey = ({ bindingId, path }: BindingPlace): string =>
  [bindingId, ...path].join(".");

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

  clone(): PlaceMap<Value> {
    const copy = new PlaceMap<Value>();
    for (const [key, entry] of this.#entries) copy.#entries.set(key, entry);
    return copy;
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
