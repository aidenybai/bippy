import {
  booleanValue,
  branchValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getObjectProperty,
  getTruthiness,
  hasDefiniteItems,
  isFunctionValue,
  isUndefinedValue,
  mapValue,
  objectFromRecord,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { recordInputSource } from "../evaluate/predicates.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type {
  CapturedSwrEntry,
  LibraryValueProvider,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// `useSWR` is the only part of SWR that is modeled. Its result is the snapshot
// `useSWRHandler` reads from the cache under the serialized key. When the page's
// SWR cache was captured and holds that key, the entry decides `data`, `error`,
// `isValidating` and `isLoading` (a field the entry lacks falls back to the
// first-render default, as `useSWRHandler` does); otherwise a hook that
// revalidates on mount has fetched (and either succeeded or failed).

export const SWR_PACKAGES = ["swr"];

interface SwrOptions {
  hasFetcher: boolean;
  config: StaticObjectValue | null;
}

const unknownBoolean = (reason: string): StaticValue =>
  branchValue([FALSE_VALUE, TRUE_VALUE], reason);

const fetchedData = (): StaticValue =>
  recordInputSource(unknownValue("data fetched by SWR at runtime"), "fetch");

/** SWR's `stableHash`: null when a value the hash depends on is uncertain or has identity-based hashing (class instances, Map, Set). */
const stableHash = (value: StaticValue): string | null => {
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "string" ? JSON.stringify(value.value) : `${value.value}`;
    case "list": {
      if (!hasDefiniteItems(value)) return null;
      let hash = "@";
      for (const item of value.items) {
        const itemHash = stableHash(item);
        if (itemHash === null) return null;
        hash += `${itemHash},`;
      }
      return hash;
    }
    case "object": {
      if (value.constructedBy || value.prototype || value.hasNullPrototype) return null;
      const keys = getKnownObjectKeys(value);
      if (keys === null) return null;
      let hash = "#";
      for (const key of keys.sort().reverse()) {
        const property = getObjectProperty(value, key);
        if (isUndefinedValue(property)) continue;
        const propertyHash = stableHash(property);
        if (propertyHash === null) return null;
        hash += `${key}:${propertyHash},`;
      }
      return hash;
    }
    default:
      return null;
  }
};

/** SWR's `serialize`: the cache key for a resolved key argument; `""` for a falsy key or empty array. */
const serializeKey = (key: StaticValue): string | null => {
  if (key.kind === "primitive" && typeof key.value === "string") return key.value;
  if (key.kind === "list") {
    if (!hasDefiniteItems(key)) return null;
    return key.items.length === 0 ? "" : stableHash(key);
  }
  const truthiness = getTruthiness(key);
  if (truthiness === null) return null;
  return truthiness ? stableHash(key) : "";
};

const readOption = (options: SwrOptions, name: string): StaticValue =>
  options.config ? getObjectProperty(options.config, name) : UNDEFINED_VALUE;

const readBooleanOption = (options: SwrOptions, name: string): boolean | null | undefined => {
  const option = readOption(options, name);
  return isUndefinedValue(option) ? undefined : getTruthiness(option);
};

const isPaused = (options: SwrOptions, tools: StubRenderTools): boolean | null => {
  const option = readOption(options, "isPaused");
  return isFunctionValue(option) ? getTruthiness(tools.call(option, [])) : false;
};

/**
 * Whether a mounting hook revalidates: `shouldDoInitialRevalidation` of
 * `useSWRHandler`, whose `data` is fallback-aware, or the `shouldStartRequest`
 * of its snapshot when `isSnapshot`, which does not look at `data`. Without a
 * fetcher argument the answer depends on whether an `SWRConfig` provides one.
 */
const revalidatesOnMount = (
  options: SwrOptions,
  hasKey: boolean,
  isDataUndefined: boolean,
  isSnapshot: boolean,
  tools: StubRenderTools,
): boolean | null => {
  if (!hasKey) return false;
  if (!options.hasFetcher) return null;
  const revalidateOnMount = readBooleanOption(options, "revalidateOnMount");
  if (revalidateOnMount !== undefined) return revalidateOnMount;
  const paused = isPaused(options, tools);
  if (paused !== false) return paused === null ? null : false;
  const suspense = readBooleanOption(options, "suspense") ?? false;
  const revalidateIfStale = readBooleanOption(options, "revalidateIfStale");
  if (isSnapshot) return suspense === true ? false : (revalidateIfStale ?? true);
  if (suspense === null) return null;
  if (suspense) return isDataUndefined ? false : (revalidateIfStale ?? true);
  return isDataUndefined || (revalidateIfStale ?? true);
};

const toBoolean = (value: boolean | null, reason: string): StaticValue =>
  value === null ? unknownBoolean(reason) : booleanValue(value);

const swrResult = (
  data: StaticValue,
  error: StaticValue,
  isValidating: StaticValue,
  isLoading: StaticValue,
): StaticValue =>
  objectFromRecord({
    mutate: nativeFunction("mutate", () => unknownValue("promise returned by mutate")),
    data,
    error,
    isValidating,
    isLoading,
  });

const capturedSwrResult = (
  entry: CapturedSwrEntry,
  fallback: StaticValue,
  options: SwrOptions,
  tools: StubRenderTools,
): StaticValue => {
  const keyName = `SWR key ${entry.key}`;
  const cachedData =
    entry.data === undefined ? UNDEFINED_VALUE : tools.captured(entry.data, `${keyName} data`);
  const data = isUndefinedValue(cachedData) ? fallback : cachedData;
  const error =
    entry.error === undefined ? UNDEFINED_VALUE : tools.captured(entry.error, `${keyName} error`);
  const startsRequest = revalidatesOnMount(options, true, false, true, tools);
  const validatingDefault =
    startsRequest === false
      ? revalidatesOnMount(options, true, isUndefinedValue(data), false, tools)
      : startsRequest;
  const reason = `whether ${keyName} revalidates on mount`;
  return swrResult(
    data,
    error,
    entry.isValidating === undefined
      ? toBoolean(validatingDefault, reason)
      : booleanValue(entry.isValidating),
    entry.isLoading === undefined
      ? toBoolean(validatingDefault, reason)
      : booleanValue(entry.isLoading),
  );
};

const uncapturedSwrResult = (
  serializedKey: string,
  fallback: StaticValue,
  options: SwrOptions,
  tools: StubRenderTools,
): StaticValue => {
  const revalidates = revalidatesOnMount(
    options,
    serializedKey !== "",
    isUndefinedValue(fallback),
    false,
    tools,
  );
  const idle = swrResult(fallback, UNDEFINED_VALUE, FALSE_VALUE, FALSE_VALUE);
  if (revalidates === false) return idle;
  const outcome = "whether the SWR fetch succeeded or failed at runtime";
  const settled = branchValue(
    [
      swrResult(fetchedData(), UNDEFINED_VALUE, FALSE_VALUE, FALSE_VALUE),
      swrResult(
        fallback,
        unknownValue("error thrown by the SWR fetcher at runtime"),
        FALSE_VALUE,
        FALSE_VALUE,
      ),
    ],
    outcome,
  );
  return revalidates === null
    ? branchValue([idle, settled], `whether SWR key ${serializedKey} revalidates on mount`)
    : settled;
};

const useSwr = (key: StaticValue, options: SwrOptions, tools: StubRenderTools): StaticValue => {
  const serializedKey = serializeKey(key);
  if (serializedKey === null) {
    return unknownValue("SWR state for a key the analysis cannot serialize");
  }
  const fallbackData = readOption(options, "fallbackData");
  const fallbacks = readOption(options, "fallback");
  const fallback = !isUndefinedValue(fallbackData)
    ? fallbackData
    : fallbacks.kind === "object"
      ? getObjectProperty(fallbacks, serializedKey)
      : UNDEFINED_VALUE;
  const entry = tools.project.swrCache?.get(serializedKey);
  return entry
    ? capturedSwrResult(entry, fallback, options, tools)
    : uncapturedSwrResult(serializedKey, fallback, options, tools);
};

const isNullValue = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === null;

/** `normalize` of `withArgs`: `(key, fetcher?, config?)` or `(key, config?)`. */
const readArguments = (args: StaticValue[]): SwrOptions | null => {
  const [, second = UNDEFINED_VALUE, third = UNDEFINED_VALUE] = args;
  const hasFetcher = isFunctionValue(second);
  const configArgument = hasFetcher || isNullValue(second) ? third : second;
  if (configArgument.kind === "object") return { hasFetcher, config: configArgument };
  if (isUndefinedValue(configArgument) || isNullValue(configArgument)) {
    return { hasFetcher, config: null };
  }
  return null;
};

export const swrValue: LibraryValueProvider = (specifier, importedName) => {
  if (!SWR_PACKAGES.includes(specifier)) return null;
  if (importedName !== "default" && importedName !== "useSWR") return null;
  return {
    kind: "native-function",
    name: "useSWR",
    call: (args, tools) => {
      const options = readArguments(args);
      if (options === null) return unknownValue("SWR state under an uncertain configuration");
      const [keyArgument = UNDEFINED_VALUE] = args;
      const key = isFunctionValue(keyArgument) ? tools.call(keyArgument, []) : keyArgument;
      return mapValue(key, (alternative) => useSwr(alternative, options, tools));
    },
    getOwnProperty: () => undefined,
  };
};
