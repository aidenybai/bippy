import {
  getKnownObjectKeys,
  getObjectAccessor,
  getObjectProperty,
  hasDefiniteItems,
  listValue,
  objectValue,
  toIndexKey,
  UNDEFINED_VALUE,
} from "../evaluate/values.js";
import type { MutableHeapValue } from "../evaluate/heap-journal.js";
import { isUndecided } from "../evaluate/type-predicates.js";
import type { StaticObjectValue, StaticValue, StubRenderTools } from "../types.js";

// The static-value plumbing deep-merge helpers (lodash `merge`, `deepmerge`)
// share: the containers they walk, their own enumerable keys, and journaled
// member reads and writes.

export const isPlainObjectValue = (value: StaticValue): value is StaticObjectValue =>
  value.kind === "object" && value.constructedBy === undefined && value.prototype === undefined;

/** False for values whose shape or type verdict the analysis cannot settle. */
export const isDecided = (value: StaticValue): boolean =>
  !isUndecided(value) &&
  value.kind !== "repeat" &&
  !(value.kind === "unknown-primitive" && value.primitiveType === "any");

/** Own enumerable string keys as `Object.keys` lists them (indices first for arrays); null when not fully known. */
export const getContainerKeys = (container: MutableHeapValue): string[] | null => {
  if (container.kind === "object") return getKnownObjectKeys(container);
  if (!hasDefiniteItems(container)) return null;
  const propertyKeys = [...(container.properties?.keys() ?? [])].filter(
    (key) => !container.nonEnumerableKeys?.has(key),
  );
  return [...container.items.map((_, index) => String(index)), ...propertyKeys];
};

/** The data property `key` holds; null when an accessor or an indefinite array answers it. */
export const readMember = (container: MutableHeapValue, key: string): StaticValue | null => {
  if (container.kind === "object") {
    return getObjectAccessor(container, key) ? null : getObjectProperty(container, key);
  }
  const index = toIndexKey(key);
  if (index === null) return container.properties?.get(key) ?? UNDEFINED_VALUE;
  if (!hasDefiniteItems(container)) return null;
  return container.items[index] ?? UNDEFINED_VALUE;
};

export const writeMember = (
  container: MutableHeapValue,
  key: string,
  value: StaticValue,
  tools: StubRenderTools,
): boolean => {
  if (container.kind === "object") {
    tools.setProperty(container, key, value);
    return true;
  }
  const index = toIndexKey(key);
  if (index === null) return false;
  tools.setItem(container, index, value);
  return true;
};

export const cloneContainer = (source: MutableHeapValue): MutableHeapValue => {
  if (source.kind === "list") return listValue([]);
  const clone = objectValue();
  if (source.hasNullPrototype) clone.hasNullPrototype = true;
  return clone;
};

export const isContainer = (value: StaticValue): value is MutableHeapValue =>
  value.kind === "list" || value.kind === "object";
