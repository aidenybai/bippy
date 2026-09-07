import type { Fiber, FiberRoot } from "bippy";
import { traverseFiber } from "bippy";
import type {
  CapturedLinguiCatalog,
  CapturedRouteMatch,
  CapturedRouterState,
  CapturedValue,
  RootObservations,
} from "../types.js";
import { readQueryCaches, toCapturedValue } from "./query-cache.js";

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

interface DataRouterStateLike {
  location: RouterLocationLike;
  matches: RouterMatchLike[];
  loaderData: Record<string, unknown>;
  navigation: { state: CapturedRouterState["navigationState"] };
  revalidation: CapturedRouterState["revalidationState"];
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

const isDataRouterState = (value: unknown): value is DataRouterStateLike =>
  isRecord(value) &&
  isLocation(value.location) &&
  Array.isArray(value.matches) &&
  value.matches.every(isRouteMatch) &&
  isRecord(value.loaderData) &&
  isRecord(value.navigation) &&
  (value.navigation.state === "idle" ||
    value.navigation.state === "loading" ||
    value.navigation.state === "submitting") &&
  (value.revalidation === "idle" || value.revalidation === "loading");

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
});

/**
 * Library state the page's code reads at render, taken from the providers
 * mounted in the roots: TanStack caches, the active Lingui catalog and React
 * Router's data-router state. The outermost provider of each kind wins.
 */
export const readRootObservations = (roots: FiberRoot[]): RootObservations => {
  const observations: RootObservations = readQueryCaches(roots);
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
