import type {
  JournaledState,
  SourceLocation,
  StaticObjectValue,
  StaticValue,
  StringComposition,
  StubRenderTools,
  UnknownPrimitiveType,
} from "../types.js";
import { createItemsIteratorValue, getGeneratorItems } from "./generators.js";
import { getNativeIterableItems } from "./native-values.js";
import { getSearchParamsItems } from "./url-search-params.js";
import {
  accessorEntry,
  branchValue,
  FALSE_VALUE,
  ITERATOR_PROPERTY_KEY,
  listValue,
  mapValue,
  mayOverlapCompositions,
  mayReadAsText,
  objectFromRecord,
  optionalValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/**
 * `isDefinite` is false when the entry exists on some paths only (a branch key,
 * a fork whose paths disagree, or a possible `delete`). `writeOrdinal` orders
 * writes: a later write under a key that may equal this one may have replaced
 * the value.
 */
interface CollectionEntry {
  key: StaticValue;
  value: StaticValue;
  isDefinite: boolean;
  writeOrdinal: number;
}

interface CollectionState {
  entries: CollectionEntries;
  writeCount: number;
  isExternallyMutable: boolean;
}

type CollectionKind = "Map" | "Set" | "WeakMap" | "WeakSet";

const isKeyed = (kind: CollectionKind): boolean => kind === "Map" || kind === "WeakMap";

const nativeMethod = (
  name: string,
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue,
): StaticValue => ({
  kind: "native-function",
  name,
  call,
});

export type KeyIdentity = unknown;

const internedIdentities = new Map<string, symbol>();

const internIdentity = (namespace: string, name: string): symbol => {
  const qualified = `${namespace}:${name}`;
  const interned = internedIdentities.get(qualified);
  if (interned) return interned;
  const identity = Symbol(qualified);
  internedIdentities.set(qualified, identity);
  return identity;
};

const composedIdentities = new WeakMap<StaticValue, Map<string, symbol>>();

/** Strings composed alike from the same dynamic source are one string, so they share one identity. */
const getComposedIdentity = (composition: StringComposition): symbol => {
  let bySurroundings = composedIdentities.get(composition.source);
  if (!bySurroundings) {
    bySurroundings = new Map();
    composedIdentities.set(composition.source, bySurroundings);
  }
  const surroundings = `${composition.prefix}\u0000${composition.suffix}`;
  const interned = bySurroundings.get(surroundings);
  if (interned) return interned;
  const identity = Symbol(surroundings);
  bySurroundings.set(surroundings, identity);
  return identity;
};

/** What a `Map` compares keys by: the primitive itself (SameValueZero), the value's identity, or the dynamic string it stands for. */
export const getKeyIdentity = (key: StaticValue): KeyIdentity => {
  switch (key.kind) {
    case "primitive":
      return key.value;
    case "symbol":
      return internIdentity("symbol", key.key);
    case "global":
      return internIdentity("global", key.name);
    case "context":
      return key.context;
    case "unknown-primitive":
      return key.composition ? getComposedIdentity(key.composition) : key;
    default:
      return key;
  }
};

/** Values with a stable identity (or value equality) across the analysis, so a key lookup is exact. */
export const isDefiniteKey = (key: StaticValue): boolean =>
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

const isPrimitiveOfType = (key: StaticValue, primitiveType: UnknownPrimitiveType): boolean =>
  key.kind === "primitive" &&
  typeof key.value !== "symbol" &&
  (primitiveType === "any" || typeof key.value === primitiveType);

/** Whether two keys of different identities may still be the same runtime key: one is dynamic and nothing known about it rules the other out. */
const mayEqualKeys = (left: StaticValue, right: StaticValue): boolean => {
  if (isDefiniteKey(left) && isDefiniteKey(right)) return false;
  const [dynamic, other] = isDefiniteKey(left) ? [right, left] : [left, right];
  if (dynamic.kind === "branch") {
    return dynamic.alternatives.some(
      (alternative) =>
        getKeyIdentity(alternative) === getKeyIdentity(other) || mayEqualKeys(alternative, other),
    );
  }
  if (dynamic.kind !== "unknown-primitive") return true;
  if (other.kind === "unknown-primitive") {
    if (
      dynamic.primitiveType !== "any" &&
      other.primitiveType !== "any" &&
      dynamic.primitiveType !== other.primitiveType
    )
      return false;
    return (
      !dynamic.composition ||
      !other.composition ||
      mayOverlapCompositions(dynamic.composition, other.composition)
    );
  }
  if (!isDefiniteKey(other)) return true;
  if (other.kind !== "primitive" || !isPrimitiveOfType(other, dynamic.primitiveType)) return false;
  return typeof other.value !== "string" || mayReadAsText(dynamic, other.value);
};

/** Upper bound on the stored values a dynamic-key read enumerates. */
const MAX_FAN_OUT = 8;

type CollectionEntries = ReadonlyMap<KeyIdentity, CollectionEntry>;

/**
 * Module-level `Map`/`Set` caches are common in data-fetching helpers, so
 * collections are modeled exactly while every key is known. A dynamic key is
 * tracked as the value it stands for: a read under it finds the write under
 * the same one, and is otherwise any value written under a key it may equal.
 * A read under a branch the collection never saw written reads each alternative.
 */
class StaticCollection implements JournaledState<CollectionState> {
  private entries = new Map<KeyIdentity, CollectionEntry>();
  private writeCount = 0;
  private isExternallyMutable = false;

  constructor(
    readonly kind: CollectionKind,
    readonly allocation: number,
    private readonly location: SourceLocation | null,
  ) {}

  capture(): CollectionState {
    return {
      entries: new Map(this.entries),
      writeCount: this.writeCount,
      isExternallyMutable: this.isExternallyMutable,
    };
  }

  restore(snapshot: CollectionState): void {
    this.entries = new Map(snapshot.entries);
    this.writeCount = snapshot.writeCount;
    this.isExternallyMutable = snapshot.isExternallyMutable;
  }

  join(
    snapshots: CollectionState[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
  ): void {
    this.writeCount = Math.max(...snapshots.map((snapshot) => snapshot.writeCount));
    this.isExternallyMutable = snapshots.some((snapshot) => snapshot.isExternallyMutable);
    const joined = new Map<KeyIdentity, CollectionEntry>();
    for (const snapshot of snapshots) {
      for (const [identity, entry] of snapshot.entries) {
        if (joined.has(identity)) continue;
        const pathEntries = snapshots.map(
          (pathSnapshot) => pathSnapshot.entries.get(identity) ?? null,
        );
        if (pathEntries.every((pathEntry) => pathEntry === entry)) {
          joined.set(identity, entry);
          continue;
        }
        const present = pathEntries.filter((pathEntry) => pathEntry !== null);
        const preferred = pathEntries[preferredPath];
        joined.set(identity, {
          key: entry.key,
          value: branchValue(
            present.map((pathEntry) => pathEntry.value),
            reason,
            location,
            preferred ? present.indexOf(preferred) : 0,
          ),
          isDefinite: pathEntries.every((pathEntry) => pathEntry?.isDefinite ?? false),
          writeOrdinal: Math.max(...present.map((pathEntry) => pathEntry.writeOrdinal)),
        });
      }
    }
    this.entries = joined;
  }

  private find(key: StaticValue): CollectionEntry | null {
    return this.entries.get(getKeyIdentity(key)) ?? null;
  }

  /** Entries under other keys `key` may equal: all of them, or only the writes after `since`. */
  private findPossiblyEqual(key: StaticValue, since = -1): CollectionEntry[] {
    const identity = getKeyIdentity(key);
    return [...this.entries.values()].filter(
      (entry) =>
        getKeyIdentity(entry.key) !== identity &&
        entry.writeOrdinal > since &&
        mayEqualKeys(key, entry.key),
    );
  }

  private hasDynamicKeys(): boolean {
    return [...this.entries.values()].some((entry) => !isDefiniteKey(entry.key));
  }

  markExternallyMutable(): void {
    this.isExternallyMutable = true;
  }

  private describeUncertainty(method: string): string {
    return this.isExternallyMutable
      ? `${this.kind}.${method}() on a ${this.kind} mutated outside the rendered code`
      : `${this.kind}.${method}() with a dynamic key`;
  }

  private describeMaybePresent(method: string): string {
    return `${this.kind}.${method}() of an entry set on some paths only`;
  }

  private readEach(key: StaticValue, read: (alternative: StaticValue) => StaticValue): StaticValue {
    return this.find(key) ? read(key) : mapValue(key, read);
  }

  get(key: StaticValue): StaticValue {
    return this.readEach(key, (alternative) => this.getOne(alternative));
  }

  /** A dynamic key on a collection code the analysis did not run may have written to: nothing rules the outside write out. */
  private isOutsideWriteVisible(key: StaticValue): boolean {
    return this.isExternallyMutable && !isDefiniteKey(key);
  }

  private getOne(key: StaticValue): StaticValue {
    const entry = this.find(key);
    const isSettled = entry?.isDefinite === true;
    const possiblyEqual = this.findPossiblyEqual(key, isSettled ? entry.writeOrdinal : -1);
    if (possiblyEqual.length === 0 && !this.isOutsideWriteVisible(key)) {
      if (!entry) return UNDEFINED_VALUE;
      return isSettled
        ? entry.value
        : branchValue(
            [entry.value, UNDEFINED_VALUE],
            this.describeMaybePresent("get"),
            this.location,
          );
    }
    const reason = this.describeUncertainty("get");
    const stored = [...(entry ? [entry.value] : []), ...possiblyEqual.map((other) => other.value)];
    if (stored.length > MAX_FAN_OUT) return unknownValue(reason, this.location);
    if (this.isExternallyMutable) stored.push(unknownValue(reason, this.location));
    if (!isSettled) stored.push(UNDEFINED_VALUE);
    return branchValue(stored, reason, this.location);
  }

  /** A definite entry stays present through writes under other keys, so `has` on it is decided even then. */
  has(key: StaticValue): StaticValue {
    return this.readEach(key, (alternative) => {
      const entry = this.find(alternative);
      if (entry?.isDefinite && !this.isExternallyMutable) return TRUE_VALUE;
      if (
        this.isOutsideWriteVisible(alternative) ||
        this.findPossiblyEqual(alternative).length > 0
      ) {
        return unknownPrimitiveValue("boolean", this.describeUncertainty("has"));
      }
      if (!entry) return FALSE_VALUE;
      return unknownPrimitiveValue("boolean", this.describeMaybePresent("has"));
    });
  }

  private replace(entry: CollectionEntry): void {
    this.entries.set(getKeyIdentity(entry.key), entry);
  }

  private write(key: StaticValue, value: StaticValue, isDefinite: boolean): void {
    this.replace({ key, value, isDefinite, writeOrdinal: ++this.writeCount });
  }

  set(key: StaticValue, value: StaticValue): void {
    this.write(key, value, true);
  }

  private unsettle(entries: CollectionEntry[]): void {
    for (const entry of entries) this.replace({ ...entry, isDefinite: false });
  }

  delete(key: StaticValue): StaticValue {
    const existing = this.find(key);
    const possiblyEqual = this.findPossiblyEqual(key);
    this.unsettle(possiblyEqual);
    if (existing) this.entries.delete(getKeyIdentity(key));
    if (possiblyEqual.length > 0 || this.isOutsideWriteVisible(key)) {
      return unknownPrimitiveValue("boolean", this.describeUncertainty("delete"));
    }
    if (!existing) return FALSE_VALUE;
    return existing.isDefinite
      ? TRUE_VALUE
      : unknownPrimitiveValue("boolean", this.describeMaybePresent("delete"));
  }

  clear(): void {
    this.entries = new Map();
  }

  /** Entries in insertion order; code the analysis did not see may have appended more. */
  project(select: (entry: CollectionEntry) => StaticValue): StaticValue {
    if (this.hasDynamicKeys()) {
      return unknownValue(`${this.kind} with dynamic keys`, this.location);
    }
    const items = [...this.entries.values()].map((entry) =>
      entry.isDefinite
        ? select(entry)
        : optionalValue(select(entry), this.describeMaybePresent("entries"), this.location),
    );
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
    return this.hasDynamicKeys() ||
      this.isExternallyMutable ||
      [...this.entries.values()].some((entry) => !entry.isDefinite)
      ? unknownPrimitiveValue("number", `${this.kind}.size`)
      : primitiveValue(this.entries.size);
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
  return true;
};

export const createCollectionValue = (
  kind: CollectionKind,
  initial: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const self: StaticObjectValue = objectFromRecord({});
  const collection = new StaticCollection(kind, self.allocation ?? 0, location);
  if (!seedCollection(collection, kind, initial)) {
    return unknownValue(`new ${kind}() from a dynamic iterable`, location);
  }
  const keyOf = (args: StaticValue[]): StaticValue => args[0] ?? UNDEFINED_VALUE;
  const isWeak = kind === "WeakMap" || kind === "WeakSet";
  const mutatingMethod = (
    name: string,
    mutate: (args: StaticValue[]) => StaticValue,
  ): StaticValue =>
    nativeMethod(name, (args, tools) => {
      tools.recordStateMutation(collection);
      return mutate(args);
    });
  const methods: Record<string, StaticValue> = {
    get: nativeMethod("get", (args) => collection.get(keyOf(args))),
    has: nativeMethod("has", (args) => collection.has(keyOf(args))),
    delete: mutatingMethod("delete", (args) => collection.delete(keyOf(args))),
  };
  const iterationMethods: Record<string, StaticValue> = {
    clear: mutatingMethod("clear", () => {
      collection.clear();
      return UNDEFINED_VALUE;
    }),
    keys: nativeMethod("keys", () =>
      createItemsIteratorValue(collection.project((entry) => entry.key)),
    ),
    values: nativeMethod("values", () =>
      createItemsIteratorValue(collection.project((entry) => entry.value)),
    ),
    entries: nativeMethod("entries", () =>
      createItemsIteratorValue(collection.project((entry) => listValue([entry.key, entry.value]))),
    ),
    forEach: nativeMethod("forEach", ([callback], tools) => {
      const entries = collection.project((entry) => listValue([entry.value, entry.key, self]));
      if (entries.kind !== "list" || !callback) return unknownValue(`${kind}.forEach()`, location);
      for (const entry of entries.items) {
        if (entry.kind === "list") tools.call(callback, entry.items);
        else tools.call(callback, [unknownValue(`${kind}.forEach() entry`, location), self]);
      }
      return UNDEFINED_VALUE;
    }),
  };
  methods[isKeyed(kind) ? "set" : "add"] = mutatingMethod(isKeyed(kind) ? "set" : "add", (args) => {
    collection.set(keyOf(args), isKeyed(kind) ? (args[1] ?? UNDEFINED_VALUE) : keyOf(args));
    return self;
  });
  iterationMethods[ITERATOR_PROPERTY_KEY] = iterationMethods[isKeyed(kind) ? "entries" : "values"];
  const members = isWeak ? methods : { ...methods, ...iterationMethods };
  for (const [key, value] of Object.entries(members)) {
    self.entries.push({ kind: "property", key, value });
  }
  if (!isWeak) {
    self.entries.push(
      accessorEntry(
        "size",
        { get: nativeMethod("size", () => collection.size()), set: null },
        location,
      ),
    );
  }
  collectionsByValue.set(self, collection);
  return self;
};
