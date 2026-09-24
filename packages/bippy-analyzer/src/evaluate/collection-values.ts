import type { StaticObjectValue, StaticValue } from "../types.js";

export type CollectionKind = "Map" | "Set" | "WeakMap" | "WeakSet";

export interface CollectionValue {
  readonly kind: CollectionKind;
  iterate: () => StaticValue;
  markExternallyMutable: () => void;
}

export const collectionsByValue = new WeakMap<StaticObjectValue, CollectionValue>();

export const getCollectionKind = (value: StaticObjectValue): CollectionKind | null =>
  collectionsByValue.get(value)?.kind ?? null;
