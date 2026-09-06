import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
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

type CollectionKind = "Map" | "Set";

const nativeMethod = (name: string, call: (args: StaticValue[]) => StaticValue): StaticValue => ({
  kind: "native-function",
  name,
  call,
});

const isSameKey = (left: StaticValue, right: StaticValue): boolean =>
  left === right ||
  (left.kind === "primitive" && right.kind === "primitive" && Object.is(left.value, right.value));

const isDefiniteKey = (key: StaticValue): boolean =>
  key.kind === "primitive" ||
  key.kind === "object" ||
  key.kind === "list" ||
  key.kind === "function";

/**
 * Module-level `Map`/`Set` caches are common in data-fetching helpers, so
 * collections are modeled exactly while every key is known and fall back to
 * "any stored value" once a dynamic key is used.
 */
class StaticCollection {
  private readonly entries: CollectionEntry[] = [];
  private hasDynamicKeys = false;

  constructor(
    private readonly kind: CollectionKind,
    private readonly location: SourceLocation | null,
  ) {}

  private find(key: StaticValue): CollectionEntry | null {
    return this.entries.find((entry) => isSameKey(entry.key, key)) ?? null;
  }

  private isExact(key: StaticValue): boolean {
    return isDefiniteKey(key) && !this.hasDynamicKeys;
  }

  get(key: StaticValue): StaticValue {
    if (this.isExact(key)) return this.find(key)?.value ?? UNDEFINED_VALUE;
    return branchValue(
      [...this.entries.map((entry) => entry.value), UNDEFINED_VALUE],
      `${this.kind}.get() with a dynamic key`,
      this.location,
    );
  }

  has(key: StaticValue): StaticValue {
    if (this.isExact(key)) return this.find(key) ? TRUE_VALUE : FALSE_VALUE;
    return unknownPrimitiveValue("boolean", `${this.kind}.has() with a dynamic key`);
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
      return unknownPrimitiveValue("boolean", `${this.kind}.delete() with a dynamic key`);
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

  project(select: (entry: CollectionEntry) => StaticValue): StaticValue {
    if (this.hasDynamicKeys) return unknownValue(`${this.kind} with dynamic keys`, this.location);
    return listValue(this.entries.map(select));
  }

  size(): StaticValue {
    const values = this.project((entry) => entry.value);
    return values.kind === "list"
      ? getListLength(values)
      : unknownPrimitiveValue("number", `${this.kind}.size`);
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
  if (initial.kind !== "list") return false;
  for (const item of initial.items) {
    if (kind === "Set") {
      collection.set(item, item);
      continue;
    }
    if (item.kind !== "list" || item.items.length < 2) return false;
    collection.set(item.items[0], item.items[1]);
  }
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
  const self: StaticObjectValue = objectFromRecord({ size: collection.size() });
  const sizeEntry = self.entries[0];
  const withSizeRefresh = (name: string, call: (args: StaticValue[]) => StaticValue): StaticValue =>
    nativeMethod(name, (args) => {
      const result = call(args);
      if (sizeEntry.kind === "property") sizeEntry.value = collection.size();
      return result;
    });
  const methods: Record<string, StaticValue> = {
    get: nativeMethod("get", (args) => collection.get(keyOf(args))),
    has: nativeMethod("has", (args) => collection.has(keyOf(args))),
    delete: withSizeRefresh("delete", (args) => collection.delete(keyOf(args))),
    clear: withSizeRefresh("clear", () => {
      collection.clear();
      return UNDEFINED_VALUE;
    }),
    keys: nativeMethod("keys", () => collection.project((entry) => entry.key)),
    values: nativeMethod("values", () => collection.project((entry) => entry.value)),
    entries: nativeMethod("entries", () =>
      collection.project((entry) => listValue([entry.key, entry.value])),
    ),
    forEach: nativeMethod("forEach", () => unknownValue(`${kind}.forEach()`, location)),
  };
  methods[kind === "Map" ? "set" : "add"] = withSizeRefresh(
    kind === "Map" ? "set" : "add",
    (args) => {
      collection.set(keyOf(args), kind === "Map" ? (args[1] ?? UNDEFINED_VALUE) : keyOf(args));
      return self;
    },
  );
  for (const [key, value] of Object.entries(methods)) {
    self.entries.push({ kind: "property", key, value });
  }
  return self;
};

/**
 * Promises are transparent: `then`/`await`/`use` read through to the settled
 * value, so `Promise.resolve(x)` is `x` and `new Promise(executor)` is whatever
 * the executor resolves synchronously (or unknown when it defers).
 */
export const createPromiseValue = (
  executor: StaticValue | undefined,
  callExecutor: (fn: StaticValue, args: StaticValue[]) => void,
  location: SourceLocation | null,
): StaticValue => {
  let settled: StaticValue | null = null;
  const resolve = nativeMethod("resolve", (args) => {
    settled ??= args[0] ?? UNDEFINED_VALUE;
    return UNDEFINED_VALUE;
  });
  const reject = nativeMethod("reject", () => {
    settled ??= { ...unknownValue("rejected promise", location), isThrown: true };
    return UNDEFINED_VALUE;
  });
  if (executor) callExecutor(executor, [resolve, reject]);
  return settled ?? unknownValue("promise settled asynchronously", location);
};
