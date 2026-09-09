import type { SourceLocation, StaticObjectValue, StaticValue, StubRenderTools } from "../types.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  isKnownString,
  listValue,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

/**
 * `Headers` over statically known names: values are stored as the strings
 * `Headers` coerces them to, or as the uncertain value written. A dynamic name
 * makes the whole instance uncertain since every later read could observe it.
 */
export interface HeadersState {
  /** Lower-cased names, in insertion order like the runtime's. */
  entries: Map<string, StaticValue>;
  /** Set once a write used a name the analysis could not read. */
  dynamicReason: string | null;
}

const headersByValue = new WeakMap<StaticObjectValue, HeadersState>();

const nativeMethod = (
  name: string,
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue,
): StaticValue => ({ kind: "native-function", name, call });

const toHeaderName = (value: StaticValue | undefined): string | null =>
  value !== undefined && isKnownString(value) ? value.value.toLowerCase() : null;

const toHeaderValue = (value: StaticValue | undefined): StaticValue =>
  mapValue(value ?? UNDEFINED_VALUE, (alternative) =>
    alternative.kind === "primitive" ? primitiveValue(String(alternative.value)) : alternative,
  );

const concatenated = (existing: StaticValue | undefined, added: StaticValue): StaticValue =>
  existing === undefined
    ? added
    : mapValue(existing, (left) =>
        mapValue(added, (right) =>
          left.kind === "primitive" && right.kind === "primitive"
            ? primitiveValue(`${String(left.value)}, ${String(right.value)}`)
            : unknownValue("Headers.append() onto an uncertain value"),
        ),
      );

const seedFromList = (entries: Map<string, StaticValue>, items: StaticValue[]): boolean => {
  for (const item of items) {
    if (item.kind !== "list" || !hasDefiniteItems(item) || item.items.length !== 2) return false;
    const name = toHeaderName(item.items[0]);
    if (name === null) return false;
    entries.set(name, concatenated(entries.get(name), toHeaderValue(item.items[1])));
  }
  return true;
};

const seedFromObject = (entries: Map<string, StaticValue>, object: StaticObjectValue): boolean => {
  const keys = getKnownObjectKeys(object);
  if (keys === null) return false;
  for (const key of keys) {
    entries.set(key.toLowerCase(), toHeaderValue(getObjectProperty(object, key)));
  }
  return true;
};

const seedHeaders = (init: StaticValue | undefined): Map<string, StaticValue> | null => {
  const entries = new Map<string, StaticValue>();
  if (init === undefined || (init.kind === "primitive" && init.value === undefined)) return entries;
  if (init.kind === "list")
    return hasDefiniteItems(init) && seedFromList(entries, init.items) ? entries : null;
  if (init.kind !== "object") return null;
  const existing = headersByValue.get(init);
  if (existing) return existing.dynamicReason === null ? new Map(existing.entries) : null;
  return seedFromObject(entries, init) ? entries : null;
};

const pairList = (entries: Map<string, StaticValue>): StaticValue =>
  listValue([...entries].map(([name, value]) => listValue([primitiveValue(name), value])));

/** `new Headers(init)`: from pairs, a record, or another `Headers`; unknown when the init is not statically readable. */
export const createHeadersValue = (
  init: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const entries = seedHeaders(init);
  if (!entries) return unknownValue("new Headers() from a dynamic init", location);
  const state: HeadersState = { entries, dynamicReason: null };
  const reading = (name: string, read: (key: string) => StaticValue): StaticValue =>
    nativeMethod(name, (args) => {
      if (state.dynamicReason !== null) return unknownValue(state.dynamicReason, location);
      const key = toHeaderName(args[0]);
      return key === null
        ? unknownValue(`Headers.${name}() with a dynamic name`, location)
        : read(key);
    });
  const whole = (name: string, read: () => StaticValue): StaticValue =>
    nativeMethod(name, () =>
      state.dynamicReason === null ? read() : unknownValue(state.dynamicReason, location),
    );
  const writing = (name: string, write: (key: string, value: StaticValue) => void): StaticValue =>
    nativeMethod(name, (args) => {
      const key = toHeaderName(args[0]);
      if (key === null) state.dynamicReason = `Headers.${name}() with a dynamic name`;
      else write(key, toHeaderValue(args[1]));
      return UNDEFINED_VALUE;
    });
  const self = objectFromRecord({
    get: reading("get", (key) => entries.get(key) ?? NULL_VALUE),
    has: reading("has", (key) => primitiveValue(entries.has(key))),
    set: writing("set", (key, value) => entries.set(key, value)),
    append: writing("append", (key, value) =>
      entries.set(key, concatenated(entries.get(key), value)),
    ),
    delete: writing("delete", (key) => entries.delete(key)),
    entries: whole("entries", () => pairList(entries)),
    keys: whole("keys", () => listValue([...entries.keys()].map(primitiveValue))),
    values: whole("values", () => listValue([...entries.values()])),
    forEach: nativeMethod("forEach", ([callback], tools) => {
      if (state.dynamicReason !== null) return unknownValue(state.dynamicReason, location);
      if (callback === undefined) return UNDEFINED_VALUE;
      for (const [name, value] of entries)
        tools.call(callback, [value, primitiveValue(name), self]);
      return UNDEFINED_VALUE;
    }),
  });
  headersByValue.set(self, state);
  return self;
};

export const isHeadersValue = (value: StaticValue): boolean =>
  value.kind === "object" && headersByValue.has(value);

/** The modeled state behind a `Headers` value; null for other values. */
export const getHeadersState = (value: StaticValue): HeadersState | null =>
  (value.kind === "object" ? headersByValue.get(value) : undefined) ?? null;

/** What iteration over a modeled `Headers` yields: `[name, value]` pairs; null for other values. */
export const getHeadersItems = (value: StaticValue): StaticValue | null => {
  const state = getHeadersState(value);
  if (!state) return null;
  return state.dynamicReason === null ? pairList(state.entries) : unknownValue(state.dynamicReason);
};
