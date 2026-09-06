import type {
  CapturedMutation,
  CapturedQuery,
  CapturedValue,
  RuntimeObservations,
} from "./types.js";

export const OPAQUE_CAPTURE_KEY = "$bippyOpaque";

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

/** Reads observations back from JSON (a page's serialized result or a saved capture), dropping malformed parts. */
export const readObservationsJson = (value: unknown): RuntimeObservations => {
  if (!isRecord(value)) return EMPTY_OBSERVATIONS;
  const globals: Record<string, CapturedValue> = {};
  if (isRecord(value.globals)) {
    for (const [name, item] of Object.entries(value.globals)) {
      if (isCapturedValue(item)) globals[name] = item;
    }
  }
  const queries = Array.isArray(value.queries) ? value.queries.filter(isCapturedQuery) : [];
  return Array.isArray(value.mutations)
    ? { globals, queries, mutations: value.mutations.filter(isCapturedMutation) }
    : { globals, queries };
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
