import {
  FALSE_VALUE,
  NULL_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  capturedValue,
  compareIdentity,
  getObjectProperty,
  getTruthiness,
  hasDefiniteItems,
  isNullish,
  listValue,
  mapValue,
  objectFromRecord,
  primitiveValue,
  toJsonValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { recordInputSource } from "../evaluate/predicates.js";
import { nativeFunction } from "../frameworks/stubs.js";
import { hashKey } from "../observations.js";
import type {
  CapturedMutation,
  CapturedQuery,
  CapturedValue,
  LibraryValueProvider,
  ModeledExports,
  ProjectContext,
  StaticObjectValue,
  StaticSymbolValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// TanStack Query's hooks are the only part of the package that is modeled; the
// providers and option helpers are analyzed from source. A hook's result is the
// observer's `createResult` as it stands once the runtime has settled. When the
// page's query cache was captured and holds the hook's query (same `hashKey`),
// the result is rebuilt from that entry's state; otherwise a query that may
// fetch has fetched (and either succeeded or failed), a disabled query
// (`enabled: false`, `queryFn: skipToken`) is pending and idle, and no mutation
// has been triggered unless something did so on mount.

export const TANSTACK_QUERY_PACKAGES = ["@tanstack/react-query", "@tanstack/query-core"];

const SKIP_TOKEN: StaticSymbolValue = { kind: "symbol", key: "@tanstack/query-core/skipToken" };

const QUERY_HOOKS: ReadonlySet<string> = new Set([
  "useQuery",
  "useInfiniteQuery",
  "useSuspenseQuery",
  "useSuspenseInfiniteQuery",
]);

const noopPromise = (name: string): StaticValue =>
  nativeFunction(name, () => unknownValue(`promise returned by ${name}`));

const fetchedData = (): StaticValue =>
  recordInputSource(unknownValue("data fetched by the query at runtime"), "fetch");

const unknownBoolean = (reason: string): StaticValue =>
  branchValue([FALSE_VALUE, TRUE_VALUE], reason);

const unknownCount = (reason: string): StaticValue =>
  branchValue([primitiveValue(0), unknownPrimitiveValue("number", reason)], reason);

const isCallable = (value: StaticValue): boolean =>
  value.kind === "function" || value.kind === "native-function";

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const booleanValue = (value: boolean): StaticValue => (value ? TRUE_VALUE : FALSE_VALUE);

const isQueryDisabled = (options: StaticObjectValue, tools: StubRenderTools): boolean | null => {
  if (compareIdentity(getObjectProperty(options, "queryFn"), SKIP_TOKEN) === true) return true;
  const enabled = getObjectProperty(options, "enabled");
  const resolved = isCallable(enabled)
    ? tools.call(enabled, [unknownValue("the query observed by `enabled`")])
    : enabled;
  if (isUndefined(resolved)) return false;
  const truthiness = getTruthiness(resolved);
  return truthiness === null ? null : !truthiness;
};

const selectData = (options: StaticObjectValue, data: StaticValue, tools: StubRenderTools) => {
  const select = getObjectProperty(options, "select");
  return isCallable(select) ? tools.call(select, [data]) : data;
};

const findCapturedQuery = (
  options: StaticObjectValue,
  project: ProjectContext,
): CapturedQuery | null => {
  if (getObjectProperty(options, "queryKeyHashFn").kind !== "primitive") return null;
  const queryKey = toJsonValue(getObjectProperty(options, "queryKey"));
  return queryKey === undefined ? null : project.findQuery(hashKey(queryKey));
};

/** `hasNextPage`/`hasPreviousPage` from `infiniteQueryBehavior`: whether the page-param getter yields a non-nullish param for the captured pages. */
const hasMorePages = (
  options: StaticObjectValue,
  data: StaticValue,
  direction: "next" | "previous",
  tools: StubRenderTools,
): StaticValue => {
  const getPageParam = getObjectProperty(
    options,
    direction === "next" ? "getNextPageParam" : "getPreviousPageParam",
  );
  if (data.kind !== "object" || !isCallable(getPageParam)) return FALSE_VALUE;
  const pages = getObjectProperty(data, "pages");
  const pageParams = getObjectProperty(data, "pageParams");
  if (!hasDefiniteItems(pages) || !hasDefiniteItems(pageParams)) {
    return unknownBoolean(`whether the query has a ${direction} page`);
  }
  if (pages.items.length === 0) return FALSE_VALUE;
  const index = direction === "next" ? pages.items.length - 1 : 0;
  const pageParam = tools.call(getPageParam, [
    pages.items[index],
    pages,
    pageParams.items[index] ?? UNDEFINED_VALUE,
    pageParams,
  ]);
  const nullish = isNullish(pageParam);
  return nullish === null
    ? unknownBoolean(`whether the query has a ${direction} page`)
    : booleanValue(!nullish);
};

const capturedInfiniteQueryExtra = (
  options: StaticObjectValue,
  data: StaticValue,
  tools: StubRenderTools,
): Record<string, StaticValue> => ({
  ...infiniteQueryExtra(),
  hasNextPage: hasMorePages(options, data, "next", tools),
  hasPreviousPage: hasMorePages(options, data, "previous", tools),
});

/** `QueryObserver.createResult` over the captured state of the query the page settled with. */
const capturedQueryResult = (
  options: StaticObjectValue,
  captured: CapturedQuery,
  tools: StubRenderTools,
  isInfinite: boolean,
): StaticValue => {
  const queryName = `query ${captured.queryHash}`;
  let status = captured.status;
  let data =
    captured.data === undefined ? UNDEFINED_VALUE : capturedValue(captured.data, queryName);
  let isPlaceholderData = false;
  const placeholderData = getObjectProperty(options, "placeholderData");
  if (captured.data === undefined && status === "pending" && !isUndefined(placeholderData)) {
    const placeholder = isCallable(placeholderData)
      ? tools.call(placeholderData, [UNDEFINED_VALUE, UNDEFINED_VALUE])
      : placeholderData;
    if (!isUndefined(placeholder)) {
      status = "success";
      data = placeholder;
      isPlaceholderData = true;
    }
  }
  const extra = isInfinite ? capturedInfiniteQueryExtra(options, data, tools) : {};
  if (!isUndefined(data)) data = selectData(options, data, tools);
  const hasData = !isUndefined(data);
  const isFetching = captured.fetchStatus === "fetching";
  const isPending = status === "pending";
  const isError = status === "error";
  const isLoading = isPending && isFetching;
  const isFetched = captured.dataUpdateCount + captured.errorUpdateCount > 0;
  return objectFromRecord({
    status: primitiveValue(status),
    fetchStatus: primitiveValue(captured.fetchStatus),
    isPending: booleanValue(isPending),
    isSuccess: booleanValue(status === "success"),
    isError: booleanValue(isError),
    isInitialLoading: booleanValue(isLoading),
    isLoading: booleanValue(isLoading),
    data,
    dataUpdatedAt: primitiveValue(captured.dataUpdatedAt),
    error: capturedValue(captured.error, `${queryName} error`),
    errorUpdatedAt: primitiveValue(captured.errorUpdatedAt),
    failureCount: primitiveValue(captured.fetchFailureCount),
    failureReason: capturedValue(captured.fetchFailureReason, `${queryName} failure reason`),
    errorUpdateCount: primitiveValue(captured.errorUpdateCount),
    isFetched: booleanValue(isFetched),
    isFetchedAfterMount: isFetched
      ? unknownBoolean("whether the query settled after this observer mounted")
      : FALSE_VALUE,
    isFetching: booleanValue(isFetching),
    isRefetching: booleanValue(isFetching && !isPending),
    isLoadingError: booleanValue(isError && !hasData),
    isPaused: booleanValue(captured.fetchStatus === "paused"),
    isPlaceholderData: booleanValue(isPlaceholderData),
    isRefetchError: booleanValue(isError && hasData),
    isStale: booleanValue(captured.isStale),
    refetch: noopPromise("refetch"),
    promise: unknownValue("the query's result promise"),
    isEnabled: booleanValue(isQueryDisabled(options, tools) !== true),
    ...extra,
  });
};

const disabledQueryResult = (options: StaticObjectValue, tools: StubRenderTools): StaticValue => {
  const initialData = getObjectProperty(options, "initialData");
  const hasData = getTruthiness(initialData) === true;
  return objectFromRecord({
    ...queryResultCommon(),
    status: primitiveValue(hasData ? "success" : "pending"),
    fetchStatus: primitiveValue("idle"),
    isPending: hasData ? FALSE_VALUE : TRUE_VALUE,
    isSuccess: hasData ? TRUE_VALUE : FALSE_VALUE,
    isError: FALSE_VALUE,
    isLoadingError: FALSE_VALUE,
    isRefetchError: FALSE_VALUE,
    isFetched: hasData ? TRUE_VALUE : FALSE_VALUE,
    isFetchedAfterMount: FALSE_VALUE,
    data: hasData ? selectData(options, initialData, tools) : UNDEFINED_VALUE,
    error: NULL_VALUE,
    failureCount: primitiveValue(0),
    failureReason: NULL_VALUE,
    isEnabled: FALSE_VALUE,
  });
};

const settledQueryResult = (
  options: StaticObjectValue,
  tools: StubRenderTools,
  extra: Record<string, StaticValue> = {},
): StaticValue => {
  const outcome = "whether the query succeeded or failed at runtime";
  const data = selectData(options, fetchedData(), tools);
  return objectFromRecord({
    ...queryResultCommon(),
    status: branchValue([primitiveValue("success"), primitiveValue("error")], outcome),
    fetchStatus: primitiveValue("idle"),
    isPending: FALSE_VALUE,
    isSuccess: branchValue([TRUE_VALUE, FALSE_VALUE], outcome),
    isError: unknownBoolean(outcome),
    isLoadingError: unknownBoolean(outcome),
    isRefetchError: FALSE_VALUE,
    isFetched: TRUE_VALUE,
    isFetchedAfterMount: TRUE_VALUE,
    data,
    error: branchValue([NULL_VALUE, unknownValue("error thrown by the query at runtime")], outcome),
    failureCount: unknownCount("query failure count at runtime"),
    failureReason: branchValue(
      [NULL_VALUE, unknownValue("query failure reason at runtime")],
      outcome,
    ),
    isEnabled: TRUE_VALUE,
    ...extra,
  });
};

const suspenseQueryResult = (
  options: StaticObjectValue,
  tools: StubRenderTools,
  extra: Record<string, StaticValue> = {},
): StaticValue =>
  objectFromRecord({
    ...queryResultCommon(),
    status: primitiveValue("success"),
    fetchStatus: primitiveValue("idle"),
    isPending: FALSE_VALUE,
    isSuccess: TRUE_VALUE,
    isError: FALSE_VALUE,
    isLoadingError: FALSE_VALUE,
    isRefetchError: FALSE_VALUE,
    isFetched: TRUE_VALUE,
    isFetchedAfterMount: TRUE_VALUE,
    data: selectData(options, fetchedData(), tools),
    error: NULL_VALUE,
    failureCount: unknownCount("query failure count at runtime"),
    failureReason: NULL_VALUE,
    isEnabled: TRUE_VALUE,
    ...extra,
  });

const queryResultCommon = (): Record<string, StaticValue> => ({
  isInitialLoading: FALSE_VALUE,
  isLoading: FALSE_VALUE,
  isFetching: FALSE_VALUE,
  isRefetching: FALSE_VALUE,
  isPaused: FALSE_VALUE,
  isPlaceholderData: FALSE_VALUE,
  isStale: unknownBoolean("query staleness at runtime"),
  dataUpdatedAt: unknownPrimitiveValue("number", "query data timestamp"),
  errorUpdatedAt: unknownPrimitiveValue("number", "query error timestamp"),
  errorUpdateCount: unknownCount("query error update count"),
  refetch: noopPromise("refetch"),
  promise: unknownValue("the query's result promise"),
});

const infiniteQueryExtra = (): Record<string, StaticValue> => ({
  fetchNextPage: noopPromise("fetchNextPage"),
  fetchPreviousPage: noopPromise("fetchPreviousPage"),
  hasNextPage: unknownBoolean("whether the query has a next page"),
  hasPreviousPage: unknownBoolean("whether the query has a previous page"),
  isFetchingNextPage: FALSE_VALUE,
  isFetchingPreviousPage: FALSE_VALUE,
  isFetchNextPageError: FALSE_VALUE,
  isFetchPreviousPageError: FALSE_VALUE,
});

const queryResult = (
  hookName: string,
  options: StaticValue,
  tools: StubRenderTools,
  project: ProjectContext,
): StaticValue =>
  mapValue(options, (alternative) => {
    if (alternative.kind !== "object") {
      return unknownValue(`${hookName} options are ${alternative.kind}`);
    }
    const isInfinite = hookName.endsWith("InfiniteQuery");
    const captured = findCapturedQuery(alternative, project);
    if (captured) return capturedQueryResult(alternative, captured, tools, isInfinite);
    const extra = isInfinite ? infiniteQueryExtra() : {};
    if (hookName.startsWith("useSuspense")) return suspenseQueryResult(alternative, tools, extra);
    const isDisabled = isQueryDisabled(alternative, tools);
    if (isDisabled === true) return disabledQueryResult(alternative, tools);
    const settled = settledQueryResult(alternative, tools, extra);
    return isDisabled === false
      ? settled
      : branchValue(
          [settled, disabledQueryResult(alternative, tools)],
          "whether the query is enabled at runtime",
        );
  });

const useQueries = (hookName: string, project: ProjectContext): StaticValue =>
  nativeFunction(hookName, ([options], tools) =>
    mapValue(options ?? UNDEFINED_VALUE, (alternative) => {
      if (alternative.kind !== "object")
        return unknownValue(`${hookName} options are not an object`);
      const queries = getObjectProperty(alternative, "queries");
      const itemHook = hookName === "useQueries" ? "useQuery" : "useSuspenseQuery";
      const results = hasDefiniteItems(queries)
        ? listValue(queries.items.map((query) => queryResult(itemHook, query, tools, project)))
        : unknownValue(`${hookName} over an unknown list of queries`);
      const combine = getObjectProperty(alternative, "combine");
      return isCallable(combine) ? tools.call(combine, [results]) : results;
    }),
  );

const IDLE_MUTATION: CapturedMutation = {
  mutationHash: null,
  status: "idle",
  error: null,
  failureCount: 0,
  failureReason: null,
  isPaused: false,
  submittedAt: 0,
};

const optionalCapturedValue = (captured: CapturedValue | undefined, name: string): StaticValue =>
  captured === undefined ? UNDEFINED_VALUE : capturedValue(captured, name);

/** `MutationObserver#updateResult`: the mutation's state plus the status flags and the bound methods. */
const capturedMutationResult = (captured: CapturedMutation): StaticValue => {
  const name =
    captured.mutationHash === null ? "the mutation" : `mutation ${captured.mutationHash}`;
  return objectFromRecord({
    status: primitiveValue(captured.status),
    isIdle: booleanValue(captured.status === "idle"),
    isPending: booleanValue(captured.status === "pending"),
    isSuccess: booleanValue(captured.status === "success"),
    isError: booleanValue(captured.status === "error"),
    isPaused: booleanValue(captured.isPaused),
    data: optionalCapturedValue(captured.data, `data returned by ${name}`),
    error: capturedValue(captured.error, `error thrown by ${name}`),
    variables: optionalCapturedValue(captured.variables, `variables of ${name}`),
    context: optionalCapturedValue(captured.context, `context of ${name}`),
    failureCount: primitiveValue(captured.failureCount),
    failureReason: capturedValue(captured.failureReason, `failure reason of ${name}`),
    submittedAt: primitiveValue(captured.submittedAt),
    mutate: nativeFunction("mutate", () => UNDEFINED_VALUE),
    mutateAsync: noopPromise("mutateAsync"),
    reset: nativeFunction("reset", () => UNDEFINED_VALUE),
  });
};

const uncertainMutationResult = (): StaticValue => {
  const outcome = "whether a mutation ran before the render settled";
  return objectFromRecord({
    status: branchValue(
      ["idle", "pending", "success", "error"].map((status) => primitiveValue(status)),
      outcome,
    ),
    isIdle: branchValue([TRUE_VALUE, FALSE_VALUE], outcome),
    isPending: unknownBoolean(outcome),
    isSuccess: unknownBoolean(outcome),
    isError: unknownBoolean(outcome),
    isPaused: FALSE_VALUE,
    data: branchValue([UNDEFINED_VALUE, unknownValue("data returned by the mutation")], outcome),
    error: branchValue([NULL_VALUE, unknownValue("error thrown by the mutation")], outcome),
    variables: branchValue([UNDEFINED_VALUE, unknownValue("mutation variables")], outcome),
    context: branchValue([UNDEFINED_VALUE, unknownValue("mutation context")], outcome),
    failureCount: unknownCount("mutation failure count"),
    failureReason: branchValue([NULL_VALUE, unknownValue("mutation failure reason")], outcome),
    submittedAt: unknownCount("mutation submission timestamp"),
    mutate: nativeFunction("mutate", () => UNDEFINED_VALUE),
    mutateAsync: noopPromise("mutateAsync"),
    reset: nativeFunction("reset", () => UNDEFINED_VALUE),
  });
};

/**
 * A mutation enters the cache the first time `mutate` runs and stays while its
 * observer is mounted, so a captured cache without a matching entry means the
 * hook never left its idle state. Keyless call sites cannot be told apart once
 * some keyless mutation ran, and a key that several mutations share is left as
 * uncertain as an unrecorded cache.
 */
const findCapturedMutation = (
  options: StaticValue,
  project: ProjectContext,
): CapturedMutation | null => {
  if (options.kind !== "object") return null;
  const mutationKey = getObjectProperty(options, "mutationKey");
  const keyless = isUndefined(mutationKey);
  const jsonKey = keyless ? undefined : toJsonValue(mutationKey);
  if (!keyless && jsonKey === undefined) return null;
  const matches = project.findMutations(keyless ? null : hashKey(jsonKey));
  if (matches === null) return null;
  if (matches.length === 0) return IDLE_MUTATION;
  return !keyless && matches.length === 1 ? matches[0] : null;
};

const useMutation = (project: ProjectContext): StaticValue =>
  nativeFunction("useMutation", ([options]) =>
    mapValue(options ?? UNDEFINED_VALUE, (alternative) => {
      const captured = findCapturedMutation(alternative, project);
      return captured ? capturedMutationResult(captured) : uncertainMutationResult();
    }),
  );

export const tanstackQueryValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (!TANSTACK_QUERY_PACKAGES.includes(specifier)) return null;
  if (importedName === "skipToken") return SKIP_TOKEN;
  if (QUERY_HOOKS.has(importedName)) {
    return nativeFunction(importedName, ([options], tools) =>
      queryResult(importedName, options ?? UNDEFINED_VALUE, tools, project),
    );
  }
  switch (importedName) {
    case "useQueries":
    case "useSuspenseQueries":
      return useQueries(importedName, project);
    case "useMutation":
      return useMutation(project);
    case "useIsFetching":
      return nativeFunction(importedName, () => unknownCount("queries fetching at runtime"));
    case "useIsMutating":
      return nativeFunction(importedName, () => unknownCount("mutations running at runtime"));
    case "useMutationState":
      return nativeFunction(importedName, () => unknownValue("mutation cache state at runtime"));
    case "usePrefetchQuery":
    case "usePrefetchInfiniteQuery":
      return nativeFunction(importedName, () => UNDEFINED_VALUE);
    default:
      return null;
  }
};

const MODELED_EXPORT_NAMES: readonly string[] = [
  "skipToken",
  ...QUERY_HOOKS,
  "useQueries",
  "useSuspenseQueries",
  "useMutation",
  "useIsFetching",
  "useIsMutating",
  "useMutationState",
  "usePrefetchQuery",
  "usePrefetchInfiniteQuery",
];

export const TANSTACK_QUERY_MODELED_EXPORTS: ModeledExports = Object.fromEntries(
  TANSTACK_QUERY_PACKAGES.map((specifier) => [specifier, MODELED_EXPORT_NAMES]),
);
