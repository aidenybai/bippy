import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import { getGeneratorItems } from "./generators.js";
import { getNativeIterableItems } from "./native-values.js";
import { getSearchParamsItems } from "./url-search-params.js";
import {
  branchValue,
  FALSE_VALUE,
  getListLength,
  listValue,
  objectFromRecord,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

interface CollectionEntry {
  key: StaticValue;
  value: StaticValue;
}

export type CollectionKind = "Map" | "Set" | "WeakMap" | "WeakSet";

const isKeyed = (kind: CollectionKind): boolean => kind === "Map" || kind === "WeakMap";

const nativeMethod = (name: string, call: (args: StaticValue[]) => StaticValue): StaticValue => ({
  kind: "native-function",
  name,
  call,
});

const isSameKey = (left: StaticValue, right: StaticValue): boolean =>
  left === right ||
  (left.kind === "primitive" && right.kind === "primitive" && Object.is(left.value, right.value)) ||
  (left.kind === "symbol" && right.kind === "symbol" && left.key === right.key) ||
  (left.kind === "context" && right.kind === "context" && left.context === right.context) ||
  (left.kind === "global" && right.kind === "global" && left.name === right.name);

/** Values with a stable identity (or value equality) across the analysis, so a key lookup is exact. */
const isDefiniteKey = (key: StaticValue): boolean =>
  key.kind === "primitive" ||
  key.kind === "symbol" ||
  key.kind === "object" ||
  key.kind === "list" ||
  key.kind === "function" ||
  key.kind === "native-function" ||
  key.kind === "class" ||
  key.kind === "context" ||
  key.kind === "global" ||
  key.kind === "native-object" ||
  key.kind === "element";

/**
 * Module-level `Map`/`Set` caches are common in data-fetching helpers, so
 * collections are modeled exactly while every key is known and fall back to
 * "any stored value" once a dynamic key is used.
 */
class StaticCollection {
  private readonly entries: CollectionEntry[] = [];
  private hasDynamicKeys = false;
  private isExternallyMutable = false;

  constructor(
    readonly kind: CollectionKind,
    private readonly location: SourceLocation | null,
  ) {}

  private find(key: StaticValue): CollectionEntry | null {
    return this.entries.find((entry) => isSameKey(entry.key, key)) ?? null;
  }

  private isExact(key: StaticValue): boolean {
    return isDefiniteKey(key) && !this.hasDynamicKeys && !this.isExternallyMutable;
  }

  markExternallyMutable(): void {
    this.isExternallyMutable = true;
  }

  private describeUncertainty(method: string): string {
    return this.isExternallyMutable
      ? `${this.kind}.${method}() on a ${this.kind} mutated outside the rendered code`
      : `${this.kind}.${method}() with a dynamic key`;
  }

  get(key: StaticValue): StaticValue {
    if (this.isExact(key)) return this.find(key)?.value ?? UNDEFINED_VALUE;
    const reason = this.describeUncertainty("get");
    if (this.hasDynamicKeys || !isDefiniteKey(key)) {
      const stored = this.entries.map((entry) => entry.value);
      if (this.isExternallyMutable) stored.push(unknownValue(reason, this.location));
      return branchValue([...stored, UNDEFINED_VALUE], reason, this.location);
    }
    // Registrations the analysis saw are the likely runtime contents; code it
    // did not see may still have changed them.
    return branchValue(
      [this.find(key)?.value ?? UNDEFINED_VALUE, unknownValue(reason, this.location)],
      reason,
      this.location,
    );
  }

  has(key: StaticValue): StaticValue {
    if (this.isExact(key)) return this.find(key) ? TRUE_VALUE : FALSE_VALUE;
    return unknownPrimitiveValue("boolean", this.describeUncertainty("has"));
  }

  set(key: StaticValue, value: StaticValue): void {
    if (!isDefiniteKey(key)) this.hasDynamicKeys = true;
    const existing = this.find(key);
    if (existing) existing.value = value;
    else this.entries.push({ key, value });
  }

  delete(key: StaticValue): StaticValue {
    if (!this.isExact(key)) {
      this.hasDynamicKeys = true;
      return unknownPrimitiveValue("boolean", this.describeUncertainty("delete"));
    }
    const index = this.entries.findIndex((entry) => isSameKey(entry.key, key));
    if (index === -1) return FALSE_VALUE;
    this.entries.splice(index, 1);
    return TRUE_VALUE;
  }

  clear(): void {
    this.entries.length = 0;
    this.hasDynamicKeys = false;
  }

  /** Entries in insertion order; code the analysis did not see may have appended more. */
  project(select: (entry: CollectionEntry) => StaticValue): StaticValue {
    if (this.hasDynamicKeys) return unknownValue(`${this.kind} with dynamic keys`, this.location);
    const items = this.entries.map(select);
    if (this.isExternallyMutable) {
      items.push({
        kind: "repeat",
        item: unknownValue(`${this.kind} mutated outside the rendered code`, this.location),
        location: this.location,
      });
    }
    return listValue(items);
  }

  iterate(): StaticValue {
    return this.project((entry) =>
      isKeyed(this.kind) ? listValue([entry.key, entry.value]) : entry.value,
    );
  }

  size(): StaticValue {
    return this.hasDynamicKeys || this.isExternallyMutable
      ? unknownPrimitiveValue("number", `${this.kind}.size`)
      : getListLength(listValue(this.entries.map((entry) => entry.value)));
  }
}

const seedCollection = (
  collection: StaticCollection,
  kind: CollectionKind,
  initial: StaticValue | undefined,
): boolean => {
  if (
    !initial ||
    (initial.kind === "primitive" && (initial.value === null || initial.value === undefined))
  )
    return true;
  const items = getCollectionItems(initial) ?? initial;
  if (items.kind !== "list") return false;
  for (const item of items.items) {
    if (!isKeyed(kind)) {
      collection.set(item, item);
      continue;
    }
    if (item.kind !== "list" || item.items.length < 2) return false;
    collection.set(item.items[0], item.items[1]);
  }
  return true;
};

const collectionsByValue = new WeakMap<StaticObjectValue, StaticCollection>();

/** What `for..of`, spread and `Array.from` see: `[key, value]` pairs for a `Map` or `URLSearchParams`, values for a `Set`; null for other values. */
export const getCollectionItems = (value: StaticValue): StaticValue | null => {
  const collection = value.kind === "object" ? collectionsByValue.get(value) : undefined;
  if (value.kind === "native-object") return getNativeIterableItems(value);
  if (!collection) return getSearchParamsItems(value) ?? getGeneratorItems(value);
  if (collection.kind === "WeakMap" || collection.kind === "WeakSet") return null;
  return collection.iterate();
};

export const getCollectionKind = (value: StaticObjectValue): CollectionKind | null =>
  collectionsByValue.get(value)?.kind ?? null;

export const markCollectionExternallyMutable = (value: StaticObjectValue): boolean => {
  const collection = collectionsByValue.get(value);
  if (!collection) return false;
  collection.markExternallyMutable();
  const sizeEntry = value.entries.find(
    (entry) => entry.kind === "property" && entry.key === "size",
  );
  if (sizeEntry?.kind === "property") sizeEntry.value = collection.size();
  return true;
};

export const createCollectionValue = (
  kind: CollectionKind,
  initial: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const collection = new StaticCollection(kind, location);
  if (!seedCollection(collection, kind, initial)) {
    return unknownValue(`new ${kind}() from a dynamic iterable`, location);
  }
  const keyOf = (args: StaticValue[]): StaticValue => args[0] ?? UNDEFINED_VALUE;
  const isWeak = kind === "WeakMap" || kind === "WeakSet";
  const self: StaticObjectValue = objectFromRecord(isWeak ? {} : { size: collection.size() });
  const sizeEntry = isWeak ? null : self.entries[0];
  const withSizeRefresh = (name: string, call: (args: StaticValue[]) => StaticValue): StaticValue =>
    nativeMethod(name, (args) => {
      const result = call(args);
      if (sizeEntry?.kind === "property") sizeEntry.value = collection.size();
      return result;
    });
  const methods: Record<string, StaticValue> = {
    get: nativeMethod("get", (args) => collection.get(keyOf(args))),
    has: nativeMethod("has", (args) => collection.has(keyOf(args))),
    delete: withSizeRefresh("delete", (args) => collection.delete(keyOf(args))),
  };
  const iterationMethods: Record<string, StaticValue> = {
    clear: withSizeRefresh("clear", () => {
      collection.clear();
      return UNDEFINED_VALUE;
    }),
    keys: nativeMethod("keys", () => collection.project((entry) => entry.key)),
    values: nativeMethod("values", () => collection.project((entry) => entry.value)),
    entries: nativeMethod("entries", () =>
      collection.project((entry) => listValue([entry.key, entry.value])),
    ),
    forEach: {
      kind: "native-function",
      name: "forEach",
      call: ([callback], tools) => {
        const entries = collection.project((entry) => listValue([entry.value, entry.key, self]));
        if (entries.kind !== "list" || !callback)
          return unknownValue(`${kind}.forEach()`, location);
        for (const entry of entries.items) {
          if (entry.kind === "list") tools.call(callback, entry.items);
          else tools.call(callback, [unknownValue(`${kind}.forEach() entry`, location), self]);
        }
        return UNDEFINED_VALUE;
      },
    },
  };
  methods[isKeyed(kind) ? "set" : "add"] = withSizeRefresh(
    isKeyed(kind) ? "set" : "add",
    (args) => {
      collection.set(keyOf(args), isKeyed(kind) ? (args[1] ?? UNDEFINED_VALUE) : keyOf(args));
      return self;
    },
  );
  const members = isWeak ? methods : { ...methods, ...iterationMethods };
  for (const [key, value] of Object.entries(members)) {
    self.entries.push({ kind: "property", key, value });
  }
  collectionsByValue.set(self, collection);
  return self;
};
