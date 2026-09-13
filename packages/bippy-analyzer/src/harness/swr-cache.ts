import type { Fiber, FiberRoot } from "bippy";
import { getReactWorkTagsForFiber, traverseFiber } from "bippy";
import { z } from "zod";
import type { CapturedSwrEntry } from "../types.js";
import { type ExportIndex, NO_EXPORTS } from "./module-exports.js";
import { toCapturedValue } from "./query-cache.js";

const methodSchema = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === "function",
);

interface SwrCacheLike {
  get: (key: string) => unknown;
  keys: () => unknown;
}

const swrCacheShapeSchema = z.object({
  get: methodSchema,
  set: methodSchema,
  delete: methodSchema,
  keys: methodSchema,
});

/** Kept by reference: `z.object` would copy the methods off their `Map` receiver. */
const swrCacheSchema = z.custom<SwrCacheLike>(
  (value) => swrCacheShapeSchema.safeParse(value).success,
);

/** The merged config `useSWRHandler` keeps in its `configRef`, which names the cache provider the hook reads. */
const swrConfigRefSchema = z.object({
  current: z.object({
    cache: swrCacheSchema,
    mutate: methodSchema,
    compare: methodSchema,
    fallback: z.record(z.string(), z.unknown()),
  }),
});

const hookSchema = z.object({ memoizedState: z.unknown(), next: z.unknown() });

const cacheStateSchema = z.object({
  data: z.unknown().optional(),
  error: z.unknown().optional(),
  isValidating: z.boolean().optional(),
  isLoading: z.boolean().optional(),
});

const isHookFiber = (fiber: Fiber): boolean => {
  const workTags = getReactWorkTagsForFiber(fiber);
  return (
    fiber.tag === workTags.FunctionComponent ||
    fiber.tag === workTags.ForwardRef ||
    fiber.tag === workTags.SimpleMemoComponent
  );
};

const readHookCaches = (fiber: Fiber, caches: Set<SwrCacheLike>): void => {
  if (!isHookFiber(fiber)) return;
  for (
    let hook = hookSchema.safeParse(fiber.memoizedState);
    hook.success;
    hook = hookSchema.safeParse(hook.data.next)
  ) {
    const configRef = swrConfigRefSchema.safeParse(hook.data.memoizedState);
    if (configRef.success) caches.add(configRef.data.current.cache);
  }
};

const captureEntry = (
  cache: SwrCacheLike,
  key: unknown,
  exports: ExportIndex,
): CapturedSwrEntry | null => {
  if (typeof key !== "string") return null;
  const state = cacheStateSchema.safeParse(cache.get(key));
  if (!state.success) return null;
  const { data, error, isValidating, isLoading } = state.data;
  const capturedData = toCapturedValue(data, exports);
  const capturedError = toCapturedValue(error, exports);
  return {
    key,
    ...(capturedData === undefined ? {} : { data: capturedData }),
    ...(capturedError === undefined ? {} : { error: capturedError }),
    ...(isValidating === undefined ? {} : { isValidating }),
    ...(isLoading === undefined ? {} : { isLoading }),
  };
};

const isIterable = (value: unknown): value is Iterable<unknown> =>
  typeof value === "object" &&
  value !== null &&
  Symbol.iterator in value &&
  typeof value[Symbol.iterator] === "function";

const readCacheKeys = (cache: SwrCacheLike): unknown[] => {
  const keys = cache.keys();
  return isIterable(keys) ? [...keys] : [];
};

/**
 * Every SWR cache a mounted `useSWR` reads (the provider its merged config
 * names), with the state each key holds once the page settled; `null` when no
 * hook is mounted, so the cache the page's code would read is unknown.
 */
export const readSwrCaches = (
  roots: FiberRoot[],
  exports: ExportIndex = NO_EXPORTS,
): CapturedSwrEntry[] | null => {
  const caches = new Set<SwrCacheLike>();
  for (const root of roots) {
    traverseFiber(root.current, (fiber) => {
      readHookCaches(fiber, caches);
      return false;
    });
  }
  if (caches.size === 0) return null;
  const entries: CapturedSwrEntry[] = [];
  for (const cache of caches) {
    for (const key of readCacheKeys(cache)) {
      const entry = captureEntry(cache, key, exports);
      if (entry) entries.push(entry);
    }
  }
  return entries;
};
