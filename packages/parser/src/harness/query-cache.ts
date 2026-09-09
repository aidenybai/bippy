import type { Fiber, FiberRoot } from "bippy";
import { traverseFiber } from "bippy";
import { dateCapture, hashKey, isPlainObject, opaqueCapture } from "../observations.js";
import { type ExportIndex, NO_EXPORTS } from "./module-exports.js";
import type {
  CapturedMutation,
  CapturedQuery,
  CapturedQueryCaches,
  CapturedValue,
} from "../types.js";

interface QueryLike {
  queryHash: string;
  state: Record<string, unknown>;
  isStale: () => boolean;
}

interface MutationLike {
  options: { mutationKey?: unknown };
  state: Record<string, unknown>;
}

interface QueryClientLike {
  getQueryCache: () => { getAll: () => QueryLike[] };
  getMutationCache: () => { getAll: () => MutationLike[] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const describeOpaque = (value: unknown): string => {
  if (typeof value === "function") return `function ${value.name || "(anonymous)"}`;
  if (isRecord(value)) return value.constructor?.name || "object";
  return typeof value;
};

/**
 * Serializes what JSON can carry, names nodes that are a loaded module's export,
 * and marks the rest opaque; `undefined` is returned for absent values so callers omit them.
 */
export const toCapturedValue = (
  value: unknown,
  exports: ExportIndex = NO_EXPORTS,
  seen: Set<object> = new Set(),
): CapturedValue | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : opaqueCapture(String(value));
  if (typeof value === "function" || isRecord(value)) {
    const reference = exports.find(value);
    if (reference !== undefined) return reference;
  }
  if (!isRecord(value)) return opaqueCapture(describeOpaque(value));
  if (value instanceof Date) return dateCapture(value);
  if (seen.has(value)) return opaqueCapture("cycle");
  seen.add(value);
  if (value instanceof Error) {
    const entries: Record<string, CapturedValue> = { name: value.name, message: value.message };
    for (const [key, item] of Object.entries(value)) {
      const captured = toCapturedValue(item, exports, seen);
      if (captured !== undefined) entries[key] = captured;
    }
    return entries;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toCapturedValue(item, exports, seen) ?? null);
  }
  if (!isPlainObject(value)) return opaqueCapture(describeOpaque(value));
  const entries: Record<string, CapturedValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const captured = toCapturedValue(item, exports, seen);
    if (captured !== undefined) entries[key] = captured;
  }
  return entries;
};

const isQueryClient = (value: unknown): value is QueryClientLike =>
  isRecord(value) &&
  typeof value.getQueryCache === "function" &&
  typeof value.getMutationCache === "function";

const getProviderClient = (fiber: Fiber): QueryClientLike | null => {
  const props: unknown = fiber.memoizedProps;
  if (!isRecord(props)) return null;
  const client = props.client;
  return isQueryClient(client) ? client : null;
};

const readNumber = (state: Record<string, unknown>, key: string): number => {
  const value = state[key];
  return typeof value === "number" ? value : 0;
};

const readStatus = (value: unknown): CapturedQuery["status"] =>
  value === "success" || value === "error" ? value : "pending";

const readMutationStatus = (value: unknown): CapturedMutation["status"] =>
  value === "pending" || value === "success" || value === "error" ? value : "idle";

const optionalCapture = (key: string, value: unknown): Record<string, CapturedValue> => {
  const captured = toCapturedValue(value);
  return captured === undefined ? {} : { [key]: captured };
};

const readFetchStatus = (value: unknown): CapturedQuery["fetchStatus"] =>
  value === "fetching" || value === "paused" ? value : "idle";

const captureQuery = (query: QueryLike): CapturedQuery => {
  const { state } = query;
  return {
    queryHash: query.queryHash,
    status: readStatus(state.status),
    fetchStatus: readFetchStatus(state.fetchStatus),
    ...optionalCapture("data", state.data),
    error: toCapturedValue(state.error) ?? null,
    dataUpdateCount: readNumber(state, "dataUpdateCount"),
    dataUpdatedAt: readNumber(state, "dataUpdatedAt"),
    errorUpdateCount: readNumber(state, "errorUpdateCount"),
    errorUpdatedAt: readNumber(state, "errorUpdatedAt"),
    fetchFailureCount: readNumber(state, "fetchFailureCount"),
    fetchFailureReason: toCapturedValue(state.fetchFailureReason) ?? null,
    isInvalidated: state.isInvalidated === true,
    isStale: query.isStale(),
  };
};

const captureMutation = (mutation: MutationLike): CapturedMutation => {
  const { state } = mutation;
  const { mutationKey } = mutation.options;
  return {
    mutationHash: mutationKey === undefined ? null : hashKey(mutationKey),
    status: readMutationStatus(state.status),
    ...optionalCapture("data", state.data),
    error: toCapturedValue(state.error) ?? null,
    ...optionalCapture("variables", state.variables),
    ...optionalCapture("context", state.context),
    failureCount: readNumber(state, "failureCount"),
    failureReason: toCapturedValue(state.failureReason) ?? null,
    isPaused: state.isPaused === true,
    submittedAt: readNumber(state, "submittedAt"),
  };
};

/** Every TanStack `QueryClient` mounted through a provider in the roots, with its caches as the page holds them. */
export const readQueryCaches = (roots: FiberRoot[]): CapturedQueryCaches => {
  const clients = new Set<QueryClientLike>();
  for (const root of roots) {
    traverseFiber(root.current, (fiber) => {
      const client = getProviderClient(fiber);
      if (client) clients.add(client);
      return false;
    });
  }
  const mounted = [...clients];
  return {
    queries: mounted.flatMap((client) => client.getQueryCache().getAll().map(captureQuery)),
    mutations: mounted.flatMap((client) => client.getMutationCache().getAll().map(captureMutation)),
  };
};
