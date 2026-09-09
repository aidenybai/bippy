import type {
  JournaledState,
  SourceLocation,
  StaticBranchValue,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { getGeneratorItems } from "./generators.js";
import { getNativeIterableItems } from "./native-values.js";
import { getSearchParamsItems } from "./url-search-params.js";
import {
  accessorEntry,
  branchValue,
  compareIdentity,
  FALSE_VALUE,
  listValue,
  mapValue,
  objectFromRecord,
  optionalValue,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/** The value an entry holds on each path of one fork (null where the path lacks it); entries of the same fork are present together. */
interface EntryPresence {
  predicate: string;
  pathValues: (StaticValue | null)[];
  preferredPath: number;
  reason: string;
  location: SourceLocation | null;
}

/** `isDefinite` is false when the entry exists on some paths only (a branch key, or a fork whose paths disagree). */
interface CollectionEntry {
  key: StaticValue;
  value: StaticValue;
  isDefinite: boolean;
  presence?: EntryPresence;
}

interface CollectionState {
  entries: CollectionEntries;
  hasDynamicKeys: boolean;
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

type KeyIdentity = unknown;

const internedIdentities = new Map<string, symbol>();

const internIdentity = (namespace: string, name: string): symbol => {
  const qualified = `${namespace}:${name}`;
  const interned = internedIdentities.get(qualified);
  if (interned) return interned;
  const identity = Symbol(qualified);
  internedIdentities.set(qualified, identity);
  return identity;
};

/** What a `Map` compares keys by: the primitive itself (SameValueZero) or the value's identity. */
const getKeyIdentity = (key: StaticValue): KeyIdentity => {
  switch (key.kind) {
    case "primitive":
      return key.value;
    case "symbol":
      return internIdentity("symbol", key.key);
    case "global":
      return internIdentity("global", key.name);
    case "context":
      return key.context;
    default:
      return key;
  }
};

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

/** Upper bound on key alternatives written one by one before the write counts as a dynamic key. */
const MAX_KEY_ALTERNATIVES = 8;

/** Upper bound on the states a projection enumerates from correlated presences before entries become independent optionals. */
const MAX_PRESENCE_STATES = 16;

const getPresenceStateCount = (entries: CollectionEntry[]): number => {
  const pathCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.presence) pathCounts.set(entry.presence.predicate, entry.presence.pathValues.length);
  }
  return [...pathCounts.values()].reduce((product, count) => product * count, 1);
};

/** A small branch whose every alternative is a definite key: the operation applies to each alternative. */
const getDefiniteKeyBranch = (key: StaticValue): StaticBranchValue | null =>
  key.kind === "branch" &&
  key.alternatives.length <= MAX_KEY_ALTERNATIVES &&
  key.alternatives.every(isDefiniteKey)
    ? key
    : null;

type CollectionEntries = ReadonlyMap<KeyIdentity, CollectionEntry>;

/**
 * Module-level `Map`/`Set` caches are common in data-fetching helpers, so
 * collections are modeled exactly while every key is known and fall back to
 * "any stored value" once a dynamic key is used.
 */
class StaticCollection implements JournaledState<CollectionState> {
  private entries = new Map<KeyIdentity, CollectionEntry>();
  private hasDynamicKeys = false;
  private isExternallyMutable = false;

  constructor(
    readonly kind: CollectionKind,
    readonly allocation: number,
    private readonly location: SourceLocation | null,
  ) {}

  capture(): CollectionState {
    return {
      entries: new Map(this.entries),
      hasDynamicKeys: this.hasDynamicKeys,
      isExternallyMutable: this.isExternallyMutable,
    };
  }

  restore(snapshot: CollectionState): void {
    this.entries = new Map(snapshot.entries);
    this.hasDynamicKeys = snapshot.hasDynamicKeys;
    this.isExternallyMutable = snapshot.isExternallyMutable;
  }

  join(
    snapshots: CollectionState[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null,
  ): void {
    this.hasDynamicKeys = snapshots.some((snapshot) => snapshot.hasDynamicKeys);
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
        const isEverywhere = present.length === pathEntries.length;
        const preferred = pathEntries[preferredPath];
        const isCorrelated =
          !isEverywhere && predicate !== null && present.every((pathEntry) => pathEntry.isDefinite);
        joined.set(identity, {
          key: entry.key,
          value: branchValue(
            present.map((pathEntry) => pathEntry.value),
            reason,
            location,
            preferred ? present.indexOf(preferred) : 0,
            isEverywhere ? predicate : null,
          ),
          isDefinite: isEverywhere && present.every((pathEntry) => pathEntry.isDefinite),
          presence: isCorrelated
            ? {
                predicate,
                pathValues: pathEntries.map((pathEntry) => pathEntry?.value ?? null),
                preferredPath,
                reason,
                location,
              }
            : undefined,
        });
      }
    }
    this.entries = joined;
  }

  /** Whether `key` may equal a dynamic key stored under another identity (or, being dynamic itself, any other key). */
  private mayCollide(key: StaticValue): boolean {
    const identity = getKeyIdentity(key);
    const isDefinite = isDefiniteKey(key);
    for (const [entryIdentity, entry] of this.entries) {
      if (entryIdentity === identity || (isDefinite && isDefiniteKey(entry.key))) continue;
      if (compareIdentity(key, entry.key) !== false) return true;
    }
    return false;
  }

  private isExact(key: StaticValue): boolean {
    return !this.hasDynamicKeys && !this.mayCollide(key);
  }

  private find(key: StaticValue): CollectionEntry | null {
    const exact = this.entries.get(getKeyIdentity(key));
    if (exact) return exact;
    for (const entry of this.entries.values()) {
      if (compareIdentity(key, entry.key) === true) return entry;
    }
    return null;
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

  get(key: StaticValue): StaticValue {
    return mapValue(key, (alternative) => this.getOne(alternative));
  }

  private getOne(key: StaticValue): StaticValue {
    if (!this.isExact(key)) {
      const reason = this.describeUncertainty("get");
      const stored = [...this.entries.values()].map((entry) => entry.value);
      if (this.isExternallyMutable) stored.push(unknownValue(reason, this.location));
      return branchValue([...stored, UNDEFINED_VALUE], reason, this.location);
    }
    const entry = this.find(key);
    if (!entry) return UNDEFINED_VALUE;
    if (entry.isDefinite) return entry.value;
    const presence = entry.presence;
    if (presence) {
      return branchValue(
        presence.pathValues.map((pathValue) => pathValue ?? UNDEFINED_VALUE),
        presence.reason,
        presence.location,
        presence.preferredPath,
        presence.predicate,
      );
    }
    return branchValue(
      [entry.value, UNDEFINED_VALUE],
      this.describeMaybePresent("get"),
      this.location,
    );
  }

  has(key: StaticValue): StaticValue {
    return mapValue(key, (alternative) => {
      if (!this.isExact(alternative)) {
        return unknownPrimitiveValue("boolean", this.describeUncertainty("has"));
      }
      const entry = this.find(alternative);
      if (!entry) return FALSE_VALUE;
      if (entry.isDefinite) return TRUE_VALUE;
      const presence = entry.presence;
      if (presence) {
        return branchValue(
          presence.pathValues.map((pathValue) => (pathValue ? TRUE_VALUE : FALSE_VALUE)),
          presence.reason,
          presence.location,
          presence.preferredPath,
          presence.predicate,
        );
      }
      return unknownPrimitiveValue("boolean", this.describeMaybePresent("has"));
    });
  }

  private replace(entry: CollectionEntry): void {
    this.entries.set(getKeyIdentity(entry.key), entry);
  }

  set(key: StaticValue, value: StaticValue): void {
    const keyBranch = getDefiniteKeyBranch(key);
    if (keyBranch) {
      keyBranch.alternatives.forEach((alternative, index) => {
        const existing = this.find(alternative);
        const reason = `${this.kind}.set() with a key that is one of several values`;
        this.replace(
          existing
            ? {
                key: alternative,
                value: branchValue(
                  [value, existing.value],
                  reason,
                  this.location,
                  index === keyBranch.preferredIndex ? 0 : 1,
                ),
                isDefinite: existing.isDefinite,
              }
            : { key: alternative, value, isDefinite: false },
        );
      });
      return;
    }
    const existing = this.find(key);
    if (existing) {
      this.replace({ ...existing, value });
      return;
    }
    if (!isDefiniteKey(key) && this.mayCollide(key)) this.hasDynamicKeys = true;
    this.replace({ key, value, isDefinite: true });
  }

  delete(key: StaticValue): StaticValue {
    const keyBranch = getDefiniteKeyBranch(key);
    if (keyBranch) {
      for (const alternative of keyBranch.alternatives) {
        const existing = this.find(alternative);
        if (existing) this.replace({ ...existing, isDefinite: false });
      }
      return unknownPrimitiveValue("boolean", this.describeUncertainty("delete"));
    }
    if (!this.isExact(key)) {
      this.hasDynamicKeys = true;
      return unknownPrimitiveValue("boolean", this.describeUncertainty("delete"));
    }
    const existing = this.find(key);
    if (!existing) return FALSE_VALUE;
    this.entries.delete(getKeyIdentity(key));
    return existing.isDefinite
      ? TRUE_VALUE
      : unknownPrimitiveValue("boolean", this.describeMaybePresent("delete"));
  }

  clear(): void {
    this.entries = new Map();
    this.hasDynamicKeys = false;
  }

  /** Entries in insertion order; code the analysis did not see may have appended more. */
  project(select: (entry: CollectionEntry) => StaticValue): StaticValue {
    if (this.hasDynamicKeys) return unknownValue(`${this.kind} with dynamic keys`, this.location);
    const entries = [...this.entries.values()];
    return this.projectEntries(
      getPresenceStateCount(entries) <= MAX_PRESENCE_STATES
        ? entries
        : entries.map(({ presence, ...entry }) => entry),
      select,
    );
  }

  /** One list per combination of fork paths, so entries written on the same path stay together. */
  private projectEntries(
    entries: CollectionEntry[],
    select: (entry: CollectionEntry) => StaticValue,
  ): StaticValue {
    const presence = entries.find((entry) => entry.presence)?.presence;
    if (presence) {
      return branchValue(
        presence.pathValues.map((_, pathIndex) =>
          this.projectEntries(
            entries.flatMap((entry) => {
              if (entry.presence?.predicate !== presence.predicate) return [entry];
              const pathValue = entry.presence.pathValues[pathIndex];
              return pathValue === null
                ? []
                : [{ key: entry.key, value: pathValue, isDefinite: true }];
            }),
            select,
          ),
        ),
        presence.reason,
        presence.location,
        presence.preferredPath,
        presence.predicate,
      );
    }
    const items = entries.map((entry) =>
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
    return this.hasDynamicKeys ||
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
    keys: nativeMethod("keys", () => collection.project((entry) => entry.key)),
    values: nativeMethod("values", () => collection.project((entry) => entry.value)),
    entries: nativeMethod("entries", () =>
      collection.project((entry) => listValue([entry.key, entry.value])),
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
