import type { Fiber, FiberRoot } from "bippy";
import { traverseFiber } from "bippy";
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

interface LinguiContextLike {
  i18n: { locale: string; messages: Record<string, unknown> };
}

interface RouterLocationLike {
  pathname: string;
  search: string;
  hash: string;
}

interface RouterMatchLike {
  route: { id: string };
  pathname: string;
  params: Record<string, string | undefined>;
}

interface FetcherLike {
  state: CapturedFetcher["state"];
  formMethod?: string;
  formAction?: string;
  formEncType?: string;
  data?: unknown;
}

interface DataRouterStateLike {
  location: RouterLocationLike;
  matches: RouterMatchLike[];
  loaderData: Record<string, unknown>;
  navigation: { state: CapturedRouterState["navigationState"] };
  revalidation: CapturedRouterState["revalidationState"];
  fetchers: Map<string, FetcherLike>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isLinguiContext = (value: unknown): value is LinguiContextLike =>
  isRecord(value) &&
  isRecord(value.i18n) &&
  typeof value.i18n.locale === "string" &&
  isRecord(value.i18n.messages) &&
  typeof value.i18n._ === "function";

const isLocation = (value: unknown): value is RouterLocationLike =>
  isRecord(value) &&
  typeof value.pathname === "string" &&
  typeof value.search === "string" &&
  typeof value.hash === "string";

const isRouteMatch = (value: unknown): value is RouterMatchLike =>
  isRecord(value) &&
  isRecord(value.route) &&
  typeof value.route.id === "string" &&
  typeof value.pathname === "string" &&
  isRecord(value.params);

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isRouterActivityState = (value: unknown): value is CapturedFetcher["state"] =>
  value === "idle" || value === "loading" || value === "submitting";

const isFetcher = (value: unknown): value is FetcherLike =>
  isRecord(value) &&
  isRouterActivityState(value.state) &&
  isOptionalString(value.formMethod) &&
  isOptionalString(value.formAction) &&
  isOptionalString(value.formEncType);

const isFetcherMap = (value: unknown): value is Map<string, FetcherLike> =>
  value instanceof Map &&
  [...value].every(([key, fetcher]) => typeof key === "string" && isFetcher(fetcher));

const isDataRouterState = (value: unknown): value is DataRouterStateLike =>
  isRecord(value) &&
  isLocation(value.location) &&
  Array.isArray(value.matches) &&
  value.matches.every(isRouteMatch) &&
  isRecord(value.loaderData) &&
  isRecord(value.navigation) &&
  isRouterActivityState(value.navigation.state) &&
  (value.revalidation === "idle" || value.revalidation === "loading") &&
  isFetcherMap(value.fetchers);

const getProviderValue = (fiber: Fiber): unknown =>
  isRecord(fiber.memoizedProps) ? fiber.memoizedProps.value : undefined;

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

const captureRouterState = (state: DataRouterStateLike): CapturedRouterState => ({
  location: {
    pathname: state.location.pathname,
    search: state.location.search,
    hash: state.location.hash,
  },
  matches: state.matches.map(captureMatch),
  loaderData: captureRecord(state.loaderData),
  navigationState: state.navigation.state,
  revalidationState: state.revalidation,
  fetchers: [...state.fetchers].map(([key, fetcher]) => captureFetcher(key, fetcher)),
});

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
      if (!observations.lingui && isLinguiContext(value))
        observations.lingui = captureLingui(value);
      if (!observations.router && isDataRouterState(value)) {
        observations.router = captureRouterState(value);
      }
      return false;
    });
  }
  return observations;
};
