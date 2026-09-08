import type { Fiber, FiberRoot } from "bippy";
import { traverseFiber } from "bippy";
import { z } from "zod";
import { routerActivityStateSchema } from "../observations.js";
import type {
  CapturedFetcher,
  CapturedLinguiCatalog,
  CapturedRouteMatch,
  CapturedRouterState,
  CapturedValue,
  RootObservations,
} from "../types.js";
import { type ExportIndex, NO_EXPORTS } from "./module-exports.js";
import { readQueryCaches, toCapturedValue } from "./query-cache.js";
import { captureStores, readProviderStores, type ReduxStoreLike } from "./redux-store.js";

const unknownRecordSchema = z.record(z.string(), z.unknown());

const functionSchema = z.custom<(...args: never[]) => unknown>(
  (value) => typeof value === "function",
);

const providerPropsSchema = z.object({ value: z.unknown().optional() });

const linguiContextSchema = z.object({
  i18n: z.object({ locale: z.string(), messages: unknownRecordSchema, _: functionSchema }),
});

const routeMatchSchema = z.object({
  route: z.object({ id: z.string() }),
  pathname: z.string(),
  params: z.record(z.string(), z.string().optional()),
});

const fetcherSchema = z.object({
  state: routerActivityStateSchema,
  formMethod: z.string().optional(),
  formAction: z.string().optional(),
  formEncType: z.string().optional(),
  data: z.unknown().optional(),
});

const dataRouterStateSchema = z.object({
  location: z.object({ pathname: z.string(), search: z.string(), hash: z.string() }),
  matches: z.array(routeMatchSchema),
  loaderData: unknownRecordSchema,
  actionData: unknownRecordSchema.nullable(),
  navigation: z.object({ state: routerActivityStateSchema }),
  revalidation: z.enum(["idle", "loading"]),
  fetchers: z.map(z.string(), fetcherSchema),
});

const serverHandoffGlobalSchema = z.object({
  __reactRouterContext: z.object({ criticalCss: z.unknown().optional() }),
});

interface LinguiContextLike extends z.infer<typeof linguiContextSchema> {}

interface RouterMatchLike extends z.infer<typeof routeMatchSchema> {}

interface FetcherLike extends z.infer<typeof fetcherSchema> {}

interface DataRouterStateLike extends z.infer<typeof dataRouterStateSchema> {}

const getProviderValue = (fiber: Fiber): unknown => {
  const props = providerPropsSchema.safeParse(fiber.memoizedProps);
  return props.success ? props.data.value : undefined;
};

const captureRecord = (record: Record<string, unknown>): Record<string, CapturedValue> => {
  const entries: Record<string, CapturedValue> = {};
  for (const [key, item] of Object.entries(record)) {
    const captured = toCapturedValue(item);
    if (captured !== undefined) entries[key] = captured;
  }
  return entries;
};

const captureMatch = (match: RouterMatchLike): CapturedRouteMatch => {
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(match.params)) {
    if (typeof value === "string") params[name] = value;
  }
  return { id: match.route.id, pathname: match.pathname, params };
};

const captureFetcher = (key: string, fetcher: FetcherLike): CapturedFetcher => ({
  key,
  state: fetcher.state,
  formMethod: fetcher.formMethod,
  formAction: fetcher.formAction,
  formEncType: fetcher.formEncType,
  data: toCapturedValue(fetcher.data),
});

const captureLingui = (context: LinguiContextLike): CapturedLinguiCatalog => ({
  locale: context.i18n.locale,
  messages: captureRecord(context.i18n.messages),
});

const captureRouterState = (state: DataRouterStateLike): CapturedRouterState => {
  const captured: CapturedRouterState = {
    location: {
      pathname: state.location.pathname,
      search: state.location.search,
      hash: state.location.hash,
    },
    matches: state.matches.map(captureMatch),
    loaderData: captureRecord(state.loaderData),
    actionData: state.actionData === null ? null : captureRecord(state.actionData),
    navigationState: state.navigation.state,
    revalidationState: state.revalidation,
    fetchers: [...state.fetchers].map(([key, fetcher]) => captureFetcher(key, fetcher)),
  };
  const handoff = serverHandoffGlobalSchema.safeParse(globalThis);
  if (handoff.success) {
    captured.hasCriticalCss = handoff.data.__reactRouterContext.criticalCss !== undefined;
  }
  return captured;
};

/**
 * Library state the page's code reads at render, taken from the providers
 * mounted in the roots: TanStack caches, the active Lingui catalog, React
 * Router's data-router state and Redux stores (those handed down by a
 * react-redux provider plus `hookedStores`, the ones the page created through
 * the DevTools hook). The outermost provider of each kind wins.
 */
export const readRootObservations = (
  roots: FiberRoot[],
  hookedStores: ReduxStoreLike[] = [],
  exports: ExportIndex = NO_EXPORTS,
): RootObservations => {
  const observations: RootObservations = readQueryCaches(roots);
  const stores = [...hookedStores];
  for (const store of readProviderStores(roots)) {
    if (!stores.includes(store)) stores.push(store);
  }
  if (stores.length > 0) observations.stores = captureStores(stores, exports);
  for (const root of roots) {
    traverseFiber(root.current, (fiber) => {
      const value = getProviderValue(fiber);
      if (!observations.lingui) {
        const lingui = linguiContextSchema.safeParse(value);
        if (lingui.success) observations.lingui = captureLingui(lingui.data);
      }
      if (!observations.router) {
        const router = dataRouterStateSchema.safeParse(value);
        if (router.success) observations.router = captureRouterState(router.data);
      }
      return false;
    });
  }
  return observations;
};
