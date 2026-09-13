import type { SourceLocation, StaticObjectValue, StaticValue, StubRenderTools } from "../types.js";
import {
  accessorEntry,
  getKnownObjectKeys,
  getObjectProperty,
  listValue,
  NULL_VALUE,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

interface SearchParamsState {
  params: URLSearchParams;
  /** Set once a write used a key or value the analysis could not read. */
  dynamicReason: string | null;
}

interface SearchParamsOptions {
  isReadonly?: boolean;
  location?: SourceLocation | null;
}

const searchParamsByValue = new WeakMap<StaticObjectValue, SearchParamsState>();

const nativeMethod = (
  name: string,
  call: (args: StaticValue[], tools: StubRenderTools) => StaticValue,
): StaticValue => ({ kind: "native-function", name, call });

const toParamString = (value: StaticValue | undefined): string | null =>
  value?.kind === "primitive" ? String(value.value) : null;

const seedFromList = (params: URLSearchParams, items: StaticValue[]): boolean =>
  items.every((item) => {
    if (item.kind !== "list" || item.items.length !== 2) return false;
    const key = toParamString(item.items[0]);
    const value = toParamString(item.items[1]);
    if (key === null || value === null) return false;
    params.append(key, value);
    return true;
  });

const seedFromObject = (params: URLSearchParams, record: StaticObjectValue): boolean => {
  const keys = getKnownObjectKeys(record);
  if (!keys) return false;
  return keys.every((key) => {
    const value = toParamString(getObjectProperty(record, key));
    if (value === null) return false;
    params.append(key, value);
    return true;
  });
};

/** The pairs `new URLSearchParams(init)` starts with, or null when `init` is not statically known. */
const seedSearchParams = (initial: StaticValue | undefined): URLSearchParams | null => {
  const params = new URLSearchParams();
  if (initial === undefined) return params;
  if (initial.kind === "primitive") {
    return initial.value === undefined ? params : new URLSearchParams(String(initial.value));
  }
  if (initial.kind === "list") return seedFromList(params, initial.items) ? params : null;
  if (initial.kind !== "object") return null;
  const existing = searchParamsByValue.get(initial);
  if (existing)
    return existing.dynamicReason === null ? new URLSearchParams(existing.params) : null;
  return seedFromObject(params, initial) ? params : null;
};

const pairList = (params: URLSearchParams): StaticValue =>
  listValue(
    [...params].map(([key, value]) => listValue([primitiveValue(key), primitiveValue(value)])),
  );

/**
 * `URLSearchParams` over statically known pairs: reads and writes with known
 * strings stay exact, and a dynamic key or value makes the whole instance
 * uncertain since every later read could observe it.
 */
export const createSearchParamsValue = (
  initial: StaticValue | undefined,
  { isReadonly = false, location = null }: SearchParamsOptions = {},
): StaticValue => {
  const params = seedSearchParams(initial);
  if (!params) return unknownValue("new URLSearchParams() from a dynamic init", location);
  const state: SearchParamsState = { params, dynamicReason: null };
  const readonlyError = (name: string): StaticValue =>
    thrownValue(
      `ReadonlyURLSearchParams.${name}()`,
      unknownValue("ReadonlyURLSearchParams mutation error", location),
      location,
    );
  const reading = (name: string, read: (key: string) => StaticValue): StaticValue =>
    nativeMethod(name, (args) => {
      const key = toParamString(args[0]);
      if (state.dynamicReason !== null) return unknownValue(state.dynamicReason, location);
      return key === null
        ? unknownValue(`URLSearchParams.${name}() with a dynamic key`, location)
        : read(key);
    });
  const whole = (name: string, read: () => StaticValue): StaticValue =>
    nativeMethod(name, () =>
      state.dynamicReason === null ? read() : unknownValue(state.dynamicReason, location),
    );
  const self = objectFromRecord({
    get: reading("get", (key) => {
      const value = params.get(key);
      return value === null ? NULL_VALUE : primitiveValue(value);
    }),
    getAll: reading("getAll", (key) => listValue(params.getAll(key).map(primitiveValue))),
    has: reading("has", (key) => primitiveValue(params.has(key))),
    toString: whole("toString", () => primitiveValue(params.toString())),
    entries: whole("entries", () => pairList(params)),
    keys: whole("keys", () => listValue([...params.keys()].map(primitiveValue))),
    values: whole("values", () => listValue([...params.values()].map(primitiveValue))),
    forEach: nativeMethod("forEach", ([callback], tools) => {
      if (state.dynamicReason !== null) return unknownValue(state.dynamicReason, location);
      if (callback === undefined) return UNDEFINED_VALUE;
      for (const [key, value] of params) {
        tools.call(callback, [primitiveValue(value), primitiveValue(key), self]);
      }
      return UNDEFINED_VALUE;
    }),
    sort: nativeMethod("sort", () => {
      if (isReadonly) return readonlyError("sort");
      params.sort();
      return UNDEFINED_VALUE;
    }),
  });
  const writing = (name: string, write: (key: string, value: string | null) => void): StaticValue =>
    nativeMethod(name, (args) => {
      if (isReadonly) return readonlyError(name);
      const key = toParamString(args[0]);
      const value = args.length > 1 ? toParamString(args[1]) : null;
      if (key === null || (args.length > 1 && value === null)) {
        state.dynamicReason = `URLSearchParams.${name}() with a dynamic key or value`;
      } else {
        write(key, value);
      }
      return UNDEFINED_VALUE;
    });
  self.entries.push(
    accessorEntry(
      "size",
      {
        get: nativeMethod("size", () =>
          state.dynamicReason === null
            ? primitiveValue(params.size)
            : unknownPrimitiveValue("number", state.dynamicReason),
        ),
        set: null,
      },
      location,
    ),
    {
      kind: "property",
      key: "set",
      value: writing("set", (key, value) => params.set(key, value ?? "undefined")),
    },
    {
      kind: "property",
      key: "append",
      value: writing("append", (key, value) => params.append(key, value ?? "undefined")),
    },
    {
      kind: "property",
      key: "delete",
      value: writing("delete", (key, value) =>
        value === null ? params.delete(key) : params.delete(key, value),
      ),
    },
  );
  searchParamsByValue.set(self, state);
  return self;
};

export const isSearchParamsValue = (value: StaticValue): boolean =>
  value.kind === "object" && searchParamsByValue.has(value);

/** What iteration over a modeled `URLSearchParams` yields: `[key, value]` pairs; null for other values. */
export const getSearchParamsItems = (value: StaticValue): StaticValue | null => {
  const state = value.kind === "object" ? searchParamsByValue.get(value) : undefined;
  if (!state) return null;
  return state.dynamicReason === null ? pairList(state.params) : unknownValue(state.dynamicReason);
};

/**
 * Replaces a modeled `URLSearchParams`' pairs the way a write to its `URL`'s
 * `search` or `href` does; a null query makes the pairs dynamic for `reason`.
 */
export const replaceSearchParams = (
  value: StaticValue,
  query: string | null,
  reason: string | null,
): void => {
  const state = value.kind === "object" ? searchParamsByValue.get(value) : undefined;
  if (!state) return;
  state.dynamicReason = reason;
  if (query !== null) {
    for (const key of [...state.params.keys()]) state.params.delete(key);
    for (const [key, item] of new URLSearchParams(query)) state.params.append(key, item);
  }
};

/** The serialized query of a modeled `URLSearchParams`; null once a write made it dynamic. */
export const getSearchParamsString = (value: StaticValue): string | null => {
  const state = value.kind === "object" ? searchParamsByValue.get(value) : undefined;
  return state === undefined || state.dynamicReason !== null ? null : state.params.toString();
};
