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
  objectValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { recordInputSource } from "../evaluate/predicates.js";
import { element, nativeFunction, stubValue } from "../evaluate/stubs.js";
import type {
  CapturedSwrEntry,
  ContextDefinition,
  LibraryValueProvider,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";

// `useSWR` and `SWRConfig` are the parts of SWR that are modeled. `useSWR`'s
// result is the snapshot `useSWRHandler` reads from the cache under the
// serialized key, under the configuration merged from the nearest `SWRConfig`
// (which is where a fetcher may come from when the call passes none). When the page's
// SWR cache was captured and holds that key, the entry decides `data`, `error`,
// `isValidating` and `isLoading` (a field the entry lacks falls back to the
// first-render default, as `useSWRHandler` does); otherwise a hook that
// revalidates on mount has fetched (and either succeeded or failed).

export const SWR_PACKAGES = ["swr"];

interface SwrOptions {
  /** Whether `fn || config.fetcher` is a function; null when the inherited fetcher is uncertain. */
  hasFetcher: boolean | null;
  /** The call's config merged over the inherited one, as `mergeConfigs` does. */
  config: StaticObjectValue;
}

interface SwrKeyHash {
  /** SWR's `stableHash` text; null when a string in the key is definite at runtime but unreadable by the analysis (`useId`). */
  text: string | null;
}

const SWR_CONFIG_CONTEXT: ContextDefinition = {
  name: "SWRConfigContext",
  displayName: null,
  defaultValue: objectValue(),
  location: null,
};

const UNREADABLE_HASH: SwrKeyHash = { text: null };

const unknownBoolean = (reason: string): StaticValue =>
  branchValue([FALSE_VALUE, TRUE_VALUE], reason);

const fetchedData = (): StaticValue =>
  recordInputSource(unknownValue("data fetched by SWR at runtime"), "fetch");

const joinHashes = (prefix: string, parts: Array<SwrKeyHash | null>): SwrKeyHash | null => {
  if (parts.some((part) => part === null)) return null;
  if (parts.some((part) => part?.text === null)) return UNREADABLE_HASH;
  return { text: `${prefix}${parts.map((part) => `${part?.text},`).join("")}` };
};

/** SWR's `stableHash`: null when a value the hash depends on is uncertain or has identity-based hashing (class instances, Map, Set). */
const stableHash = (value: StaticValue): SwrKeyHash | null => {
  switch (value.kind) {
    case "primitive":
      return {
        text: typeof value.value === "string" ? JSON.stringify(value.value) : `${value.value}`,
      };
    case "unknown-primitive":
      return value.primitiveType === "string" ? UNREADABLE_HASH : null;
    case "list":
      return hasDefiniteItems(value) ? joinHashes("@", value.items.map(stableHash)) : null;
    case "object": {
      if (value.constructedBy || value.prototype || value.hasNullPrototype) return null;
      const keys = getKnownObjectKeys(value);
      if (keys === null) return null;
      const parts: Array<SwrKeyHash | null> = [];
      for (const key of keys.sort().reverse()) {
        const property = getObjectProperty(value, key);
        if (isUndefinedValue(property)) continue;
        const propertyHash = stableHash(property);
        parts.push(
          propertyHash === null || propertyHash.text === null
            ? propertyHash
            : { text: `${key}:${propertyHash.text}` },
        );
      }
      return joinHashes("#", parts);
    }
    default:
      return null;
  }
};

/** SWR's `serialize`: the cache key for a resolved key argument; `""` for a falsy key or empty array. */
const serializeKey = (key: StaticValue): SwrKeyHash | null => {
  if (key.kind === "primitive" && typeof key.value === "string") return { text: key.value };
  if (key.kind === "list") {
    if (!hasDefiniteItems(key)) return null;
    return key.items.length === 0 ? { text: "" } : stableHash(key);
  }
  const truthiness = getTruthiness(key);
  if (truthiness === null) return null;
  return truthiness ? stableHash(key) : { text: "" };
};

const readOption = (options: SwrOptions, name: string): StaticValue =>
  getObjectProperty(options.config, name);

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
 * fetcher (own or inherited from `SWRConfig`) nothing is requested.
 */
const revalidatesOnMount = (
  options: SwrOptions,
  hasKey: boolean,
  isDataUndefined: boolean,
  isSnapshot: boolean,
  tools: StubRenderTools,
): boolean | null => {
  if (!hasKey) return false;
  if (options.hasFetcher !== true) return options.hasFetcher;
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
  keyName: string,
  hasKey: boolean,
  fallback: StaticValue,
  options: SwrOptions,
  tools: StubRenderTools,
): StaticValue => {
  const revalidates = revalidatesOnMount(options, hasKey, isUndefinedValue(fallback), false, tools);
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
    ? branchValue([idle, settled], `whether SWR key ${keyName} revalidates on mount`)
    : settled;
};

/** Keys of a `fallback` map; null when they cannot be enumerated. */
const fallbackKeys = (fallbacks: StaticValue): string[] | null =>
  fallbacks.kind === "object"
    ? getKnownObjectKeys(fallbacks)
    : getTruthiness(fallbacks) === false
      ? []
      : null;

const useSwr = (key: StaticValue, options: SwrOptions, tools: StubRenderTools): StaticValue => {
  const serializedKey = serializeKey(key);
  if (serializedKey === null) {
    return unknownValue("SWR state for a key the analysis cannot serialize");
  }
  const cache = tools.project.swrCache;
  const fallbackData = readOption(options, "fallbackData");
  const fallbacks = readOption(options, "fallback");
  if (serializedKey.text === null) {
    if (cache !== null && cache.size > 0) {
      return unknownValue(
        "SWR state for a key the analysis cannot tell apart from the captured ones",
      );
    }
    if (isUndefinedValue(fallbackData) && fallbackKeys(fallbacks)?.length !== 0) {
      return unknownValue("SWR state for a key the analysis cannot look up in the fallback map");
    }
    return uncapturedSwrResult("the analysis cannot read", true, fallbackData, options, tools);
  }
  const fallback = !isUndefinedValue(fallbackData)
    ? fallbackData
    : fallbacks.kind === "object"
      ? getObjectProperty(fallbacks, serializedKey.text)
      : UNDEFINED_VALUE;
  const entry = cache?.get(serializedKey.text);
  return entry
    ? capturedSwrResult(entry, fallback, options, tools)
    : uncapturedSwrResult(serializedKey.text, serializedKey.text !== "", fallback, options, tools);
};

const isNullValue = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === null;

const toObject = (value: StaticValue): StaticObjectValue =>
  value.kind === "object" ? value : objectValue([{ kind: "spread", value }]);

/** SWR's `mergeConfigs`: `own` over `parent`, with both sides' `fallback` maps merged. */
const mergeConfigs = (parent: StaticObjectValue, own: StaticObjectValue): StaticObjectValue => {
  const parentFallback = getObjectProperty(parent, "fallback");
  const ownFallback = getObjectProperty(own, "fallback");
  const entries: StaticObjectEntry[] = [
    { kind: "spread", value: parent },
    { kind: "spread", value: own },
  ];
  if (getTruthiness(parentFallback) === true && getTruthiness(ownFallback) === true) {
    entries.push({
      kind: "property",
      key: "fallback",
      value: objectValue([
        { kind: "spread", value: parentFallback },
        { kind: "spread", value: ownFallback },
      ]),
    });
  }
  return objectValue(entries);
};

const readInheritedConfig = (tools: StubRenderTools): StaticObjectValue =>
  toObject(tools.readContext(SWR_CONFIG_CONTEXT));

/** `normalize` of `withArgs`: `(key, fetcher?, config?)` or `(key, config?)`, merged over the inherited config. */
const readArguments = (args: StaticValue[], tools: StubRenderTools): SwrOptions | null => {
  const [, second = UNDEFINED_VALUE, third = UNDEFINED_VALUE] = args;
  const hasOwnFetcher = isFunctionValue(second);
  const configArgument = hasOwnFetcher || isNullValue(second) ? third : second;
  const ownConfig =
    configArgument.kind === "object"
      ? configArgument
      : isUndefinedValue(configArgument) || isNullValue(configArgument)
        ? objectValue()
        : null;
  if (ownConfig === null) return null;
  const config = mergeConfigs(readInheritedConfig(tools), ownConfig);
  if (getTruthiness(getObjectProperty(config, "use")) !== false) return null;
  return {
    hasFetcher: hasOwnFetcher || getTruthiness(getObjectProperty(config, "fetcher")),
    config,
  };
};

const SWR_CONFIG_STUB: StubComponent = {
  displayName: "SWRConfig",
  render: (props, tools) => {
    const parentConfig = readInheritedConfig(tools);
    const value = getObjectProperty(props, "value");
    const config = isFunctionValue(value)
      ? tools.call(value, [parentConfig])
      : mergeConfigs(parentConfig, toObject(value));
    return element(
      { kind: "context-provider", context: SWR_CONFIG_CONTEXT, displayName: null },
      objectFromRecord({ value: config, children: getObjectProperty(props, "children") }),
    );
  },
};

export const swrValue: LibraryValueProvider = (specifier, importedName) => {
  if (!SWR_PACKAGES.includes(specifier)) return null;
  if (importedName === "SWRConfig") return stubValue(SWR_CONFIG_STUB);
  if (importedName !== "default" && importedName !== "useSWR") return null;
  return {
    kind: "native-function",
    name: "useSWR",
    call: (args, tools) => {
      const options = readArguments(args, tools);
      if (options === null) return unknownValue("SWR state under an uncertain configuration");
      const [keyArgument = UNDEFINED_VALUE] = args;
      const key = isFunctionValue(keyArgument) ? tools.call(keyArgument, []) : keyArgument;
      return mapValue(key, (alternative) => useSwr(alternative, options, tools));
    },
    getOwnProperty: () => undefined,
  };
};
