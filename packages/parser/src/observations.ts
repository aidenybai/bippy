import { z } from "zod";
import { parseWithSchema } from "./errors.js";
import type {
  CapturedExportReference,
  CapturedFetcher,
  CapturedLinguiCatalog,
  CapturedMutation,
  CapturedPageState,
  CapturedRequest,
  CapturedQuery,
  CapturedRouteMatch,
  CapturedRouterState,
  CapturedSwrEntry,
  CapturedValue,
  RuntimeObservations,
} from "./types.js";

const OPAQUE_CAPTURE_KEY = "$bippyOpaque";
const EXPORT_CAPTURE_KEY = "$bippyExport";
const DATE_CAPTURE_KEY = "$bippyDate";

export const EMPTY_OBSERVATIONS: RuntimeObservations = { globals: {}, queries: [] };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value) || Array.isArray(value)) return false;
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

const capturedValueSchema: z.ZodType<CapturedValue> = z.json();
const capturedValueRecordSchema = z.record(z.string(), capturedValueSchema);
const stringRecordSchema = z.record(z.string(), z.string());

const capturedQuerySchema: z.ZodType<CapturedQuery> = z.object({
  queryHash: z.string(),
  status: z.enum(["pending", "error", "success"]),
  fetchStatus: z.enum(["fetching", "paused", "idle"]),
  data: capturedValueSchema.optional(),
  error: capturedValueSchema,
  dataUpdateCount: z.number(),
  dataUpdatedAt: z.number(),
  errorUpdateCount: z.number(),
  errorUpdatedAt: z.number(),
  fetchFailureCount: z.number(),
  fetchFailureReason: capturedValueSchema,
  isInvalidated: z.boolean(),
  isStale: z.boolean(),
});

const capturedMutationSchema: z.ZodType<CapturedMutation> = z.object({
  mutationHash: z.string().nullable(),
  status: z.enum(["idle", "pending", "success", "error"]),
  data: capturedValueSchema.optional(),
  error: capturedValueSchema,
  variables: capturedValueSchema.optional(),
  context: capturedValueSchema.optional(),
  failureCount: z.number(),
  failureReason: capturedValueSchema,
  isPaused: z.boolean(),
  submittedAt: z.number(),
});

const capturedLinguiCatalogSchema: z.ZodType<CapturedLinguiCatalog> = z.object({
  locale: z.string(),
  messages: capturedValueRecordSchema,
});

const capturedRouteMatchSchema: z.ZodType<CapturedRouteMatch> = z.object({
  id: z.string(),
  pathname: z.string(),
  params: stringRecordSchema,
});

export const routerActivityStateSchema = z.enum(["idle", "loading", "submitting"]);

const capturedFetcherSchema: z.ZodType<CapturedFetcher> = z.object({
  key: z.string(),
  state: routerActivityStateSchema,
  formMethod: z.string().optional(),
  formAction: z.string().optional(),
  formEncType: z.string().optional(),
  data: capturedValueSchema.optional(),
});

const capturedRouterStateSchema: z.ZodType<CapturedRouterState> = z.object({
  location: z.object({ pathname: z.string(), search: z.string(), hash: z.string() }),
  matches: z.array(capturedRouteMatchSchema),
  loaderData: capturedValueRecordSchema,
  actionData: capturedValueRecordSchema.nullable().optional(),
  navigationState: routerActivityStateSchema,
  revalidationState: z.enum(["idle", "loading"]),
  fetchers: z.array(capturedFetcherSchema).optional(),
  hasCriticalCss: z.boolean().optional(),
});

const capturedSwrEntrySchema: z.ZodType<CapturedSwrEntry> = z.object({
  key: z.string(),
  data: capturedValueSchema.optional(),
  error: capturedValueSchema.optional(),
  isValidating: z.boolean().optional(),
  isLoading: z.boolean().optional(),
});

const capturedPageStateSchema: z.ZodType<CapturedPageState> = z.object({
  cookie: z.string(),
  name: z.string().optional(),
  historyState: capturedValueSchema.optional(),
  windowKeys: z.array(z.string()).optional(),
  navigatorKeys: z.array(z.string()).optional(),
  userAgent: z.string().optional(),
  language: z.string().optional(),
  languages: z.array(z.string()).optional(),
  maxTouchPoints: z.number().optional(),
  localStorage: stringRecordSchema,
  sessionStorage: stringRecordSchema,
});

const capturedRequestSchema: z.ZodType<CapturedRequest> = z.object({
  headers: stringRecordSchema,
});

const observationsSchema: z.ZodType<RuntimeObservations, unknown> = z.object({
  globals: capturedValueRecordSchema.default({}),
  queries: z.array(capturedQuerySchema).default([]),
  mutations: z.array(capturedMutationSchema).optional(),
  lingui: capturedLinguiCatalogSchema.optional(),
  router: capturedRouterStateSchema.optional(),
  stores: z.array(capturedValueSchema).optional(),
  swr: z.array(capturedSwrEntrySchema).optional(),
  page: capturedPageStateSchema.optional(),
  request: capturedRequestSchema.optional(),
});

/** Reads observations back from JSON: a page's serialized result or a saved capture. */
export const readObservationsJson = (value: unknown, source: string): RuntimeObservations =>
  parseWithSchema(observationsSchema, value, source);

export const opaqueCapture = (description: string): CapturedValue => ({
  [OPAQUE_CAPTURE_KEY]: description,
});

/** The description of an opaque capture node, or null for a value JSON carried whole. */
export const getOpaqueCaptureDescription = (value: CapturedValue): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const description = value[OPAQUE_CAPTURE_KEY];
  return Object.keys(value).length === 1 && typeof description === "string" ? description : null;
};

/** A `Date` by its epoch milliseconds; `null` for an invalid date. */
export const dateCapture = (date: Date): CapturedValue => ({
  [DATE_CAPTURE_KEY]: Number.isNaN(date.getTime()) ? null : date.getTime(),
});

export const getCapturedDate = (value: CapturedValue): Date | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 1 || !(DATE_CAPTURE_KEY in value)) return null;
  const time = value[DATE_CAPTURE_KEY];
  return new Date(typeof time === "number" ? time : Number.NaN);
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
