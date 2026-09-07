import type {
  CapturedExportReference,
  CapturedLinguiCatalog,
  CapturedMutation,
  CapturedPageState,
  CapturedRequest,
  CapturedQuery,
  CapturedRouteMatch,
  CapturedRouterState,
  CapturedValue,
  RuntimeObservations,
} from "./types.js";

export const OPAQUE_CAPTURE_KEY = "$bippyOpaque";
export const EXPORT_CAPTURE_KEY = "$bippyExport";

export const EMPTY_OBSERVATIONS: RuntimeObservations = { globals: {}, queries: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** `hashKey` from `@tanstack/query-core`: the JSON of a query or mutation key with plain-object keys sorted. */
export const hashKey = (key: unknown): string =>
  JSON.stringify(key, (_property, value: unknown) =>
    isPlainObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((name) => [name, value[name]]),
        )
      : value,
  );

const isCapturedValue = (value: unknown): value is CapturedValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every(isCapturedValue)) ||
  (isRecord(value) && Object.values(value).every(isCapturedValue));

const isCapturedQuery = (value: unknown): value is CapturedQuery =>
  isRecord(value) &&
  typeof value.queryHash === "string" &&
  (value.status === "pending" || value.status === "error" || value.status === "success") &&
  (value.fetchStatus === "fetching" ||
    value.fetchStatus === "paused" ||
    value.fetchStatus === "idle") &&
  (value.data === undefined || isCapturedValue(value.data)) &&
  isCapturedValue(value.error) &&
  typeof value.dataUpdateCount === "number" &&
  typeof value.dataUpdatedAt === "number" &&
  typeof value.errorUpdateCount === "number" &&
  typeof value.errorUpdatedAt === "number" &&
  typeof value.fetchFailureCount === "number" &&
  isCapturedValue(value.fetchFailureReason) &&
  typeof value.isInvalidated === "boolean" &&
  typeof value.isStale === "boolean";

const isOptionalCapturedValue = (value: unknown): value is CapturedValue | undefined =>
  value === undefined || isCapturedValue(value);

const isCapturedMutation = (value: unknown): value is CapturedMutation =>
  isRecord(value) &&
  (value.mutationHash === null || typeof value.mutationHash === "string") &&
  (value.status === "idle" ||
    value.status === "pending" ||
    value.status === "success" ||
    value.status === "error") &&
  isOptionalCapturedValue(value.data) &&
  isCapturedValue(value.error) &&
  isOptionalCapturedValue(value.variables) &&
  isOptionalCapturedValue(value.context) &&
  typeof value.failureCount === "number" &&
  isCapturedValue(value.failureReason) &&
  typeof value.isPaused === "boolean" &&
  typeof value.submittedAt === "number";

const isCapturedValueRecord = (value: unknown): value is Record<string, CapturedValue> =>
  isRecord(value) && Object.values(value).every(isCapturedValue);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === "string");

const isCapturedLinguiCatalog = (value: unknown): value is CapturedLinguiCatalog =>
  isRecord(value) && typeof value.locale === "string" && isCapturedValueRecord(value.messages);

const isCapturedRouteMatch = (value: unknown): value is CapturedRouteMatch =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.pathname === "string" &&
  isStringRecord(value.params);

const isCapturedRouterState = (value: unknown): value is CapturedRouterState =>
  isRecord(value) &&
  isStringRecord(value.location) &&
  typeof value.location.pathname === "string" &&
  typeof value.location.search === "string" &&
  typeof value.location.hash === "string" &&
  Array.isArray(value.matches) &&
  value.matches.every(isCapturedRouteMatch) &&
  isCapturedValueRecord(value.loaderData) &&
  (value.navigationState === "idle" ||
    value.navigationState === "loading" ||
    value.navigationState === "submitting") &&
  (value.revalidationState === "idle" || value.revalidationState === "loading");

const isCapturedRequest = (value: unknown): value is CapturedRequest =>
  isRecord(value) && isStringRecord(value.headers);

const isCapturedPageState = (value: unknown): value is CapturedPageState =>
  isRecord(value) &&
  typeof value.cookie === "string" &&
  (value.name === undefined || typeof value.name === "string") &&
  isStringRecord(value.localStorage) &&
  isStringRecord(value.sessionStorage);

/** Reads observations back from JSON (a page's serialized result or a saved capture), dropping malformed parts. */
export const readObservationsJson = (value: unknown): RuntimeObservations => {
  if (!isRecord(value)) return EMPTY_OBSERVATIONS;
  const globals: Record<string, CapturedValue> = {};
  if (isRecord(value.globals)) {
    for (const [name, item] of Object.entries(value.globals)) {
      if (isCapturedValue(item)) globals[name] = item;
    }
  }
  const observations: RuntimeObservations = {
    globals,
    queries: Array.isArray(value.queries) ? value.queries.filter(isCapturedQuery) : [],
  };
  if (Array.isArray(value.mutations)) {
    observations.mutations = value.mutations.filter(isCapturedMutation);
  }
  if (isCapturedLinguiCatalog(value.lingui)) observations.lingui = value.lingui;
  if (isCapturedRouterState(value.router)) observations.router = value.router;
  if (Array.isArray(value.stores)) observations.stores = value.stores.filter(isCapturedValue);
  if (isCapturedPageState(value.page)) observations.page = value.page;
  if (isCapturedRequest(value.request)) observations.request = value.request;
  return observations;
};

export const opaqueCapture = (description: string): CapturedValue => ({
  [OPAQUE_CAPTURE_KEY]: description,
});

/** The description of an opaque capture node, or null for a value JSON carried whole. */
export const getOpaqueCaptureDescription = (value: CapturedValue): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const description = value[OPAQUE_CAPTURE_KEY];
  return Object.keys(value).length === 1 && typeof description === "string" ? description : null;
};

export const exportCapture = (reference: CapturedExportReference): CapturedValue => ({
  [EXPORT_CAPTURE_KEY]: { module: reference.module, name: reference.name },
});

/** The module export a captured node is identical to, or null for a value serialized by content. */
export const getCapturedExportReference = (
  value: CapturedValue,
): CapturedExportReference | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const reference = value[EXPORT_CAPTURE_KEY];
  if (Object.keys(value).length !== 1 || !isRecord(reference)) return null;
  const { module, name } = reference;
  return typeof module === "string" && typeof name === "string" ? { module, name } : null;
};
