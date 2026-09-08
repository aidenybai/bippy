import { z } from "zod";
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
  CapturedValue,
  JsonValue,
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

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const capturedValueRecordSchema = z.record(z.string(), jsonValueSchema);

const stringRecordSchema = z.record(z.string(), z.string());

const capturedQuerySchema: z.ZodType<CapturedQuery> = z.object({
  queryHash: z.string(),
  status: z.enum(["pending", "error", "success"]),
  fetchStatus: z.enum(["fetching", "paused", "idle"]),
  data: jsonValueSchema.optional(),
  error: jsonValueSchema,
  dataUpdateCount: z.number(),
  dataUpdatedAt: z.number(),
  errorUpdateCount: z.number(),
  errorUpdatedAt: z.number(),
  fetchFailureCount: z.number(),
  fetchFailureReason: jsonValueSchema,
  isInvalidated: z.boolean(),
  isStale: z.boolean(),
});

const capturedMutationSchema: z.ZodType<CapturedMutation> = z.object({
  mutationHash: z.string().nullable(),
  status: z.enum(["idle", "pending", "success", "error"]),
  data: jsonValueSchema.optional(),
  error: jsonValueSchema,
  variables: jsonValueSchema.optional(),
  context: jsonValueSchema.optional(),
  failureCount: z.number(),
  failureReason: jsonValueSchema,
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
  data: jsonValueSchema.optional(),
});

const capturedRouterStateSchema: z.ZodType<CapturedRouterState> = z.object({
  location: z.object({ pathname: z.string(), search: z.string(), hash: z.string() }),
  matches: z.array(capturedRouteMatchSchema),
  loaderData: capturedValueRecordSchema,
  navigationState: routerActivityStateSchema,
  revalidationState: z.enum(["idle", "loading"]),
  fetchers: z.array(capturedFetcherSchema).optional(),
});

const capturedRequestSchema: z.ZodType<CapturedRequest> = z.object({
  headers: stringRecordSchema,
});

const capturedPageStateSchema: z.ZodType<CapturedPageState> = z.object({
  cookie: z.string(),
  name: z.string().optional(),
  historyState: jsonValueSchema.optional(),
  windowKeys: z.array(z.string()).optional(),
  userAgent: z.string().optional(),
  language: z.string().optional(),
  localStorage: stringRecordSchema,
  sessionStorage: stringRecordSchema,
});

/** Every element of `value` that parses; a non-array is no elements. */
const parseEach = <T>(schema: z.ZodType<T>, value: unknown): T[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const result = schema.safeParse(item);
        return result.success ? [result.data] : [];
      })
    : [];

const parseOptional = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
};

/** Reads observations back from JSON (a page's serialized result or a saved capture), dropping malformed parts. */
export const readObservationsJson = (value: unknown): RuntimeObservations => {
  if (!isRecord(value)) return EMPTY_OBSERVATIONS;
  const globals: Record<string, CapturedValue> = {};
  if (isRecord(value.globals)) {
    for (const [name, item] of Object.entries(value.globals)) {
      const global = parseOptional(jsonValueSchema, item);
      if (global !== undefined) globals[name] = global;
    }
  }
  const observations: RuntimeObservations = {
    globals,
    queries: parseEach(capturedQuerySchema, value.queries),
  };
  if (Array.isArray(value.mutations)) {
    observations.mutations = parseEach(capturedMutationSchema, value.mutations);
  }
  if (Array.isArray(value.stores)) observations.stores = parseEach(jsonValueSchema, value.stores);
  const lingui = parseOptional(capturedLinguiCatalogSchema, value.lingui);
  if (lingui) observations.lingui = lingui;
  const router = parseOptional(capturedRouterStateSchema, value.router);
  if (router) observations.router = router;
  const page = parseOptional(capturedPageStateSchema, value.page);
  if (page) observations.page = page;
  const request = parseOptional(capturedRequestSchema, value.request);
  if (request) observations.request = request;
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
