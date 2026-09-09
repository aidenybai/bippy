import { existsSync } from "node:fs";
import path from "node:path";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  describeValue,
  getObjectProperty,
  getTruthiness,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { createSearchParamsValue, getSearchParamsString } from "../evaluate/url-search-params.js";
import { toElementType } from "../react/element-type.js";
import { findRootRenderCalls } from "../render/find-root-elements.js";
import { FS_ROUTES_PACKAGE, readFsRoutes } from "./fs-routes.js";
import { AUTO_ROUTES_PACKAGE, readAutoRoutes } from "./react-router-auto-routes.js";
import { importsCriticalCss } from "./remix-critical-css.js";
import { type ObservedRouterState, observeRouterState } from "./react-router-observed.js";
import {
  FLAT_ROUTES_PACKAGE,
  ROUTES_OPTION_ADAPTER_PACKAGE,
  readFlatRoutes,
} from "./remix-flat-routes.js";
import {
  type FrameworkDocument,
  dedupeLinkDescriptors,
  renderLinkDescriptors,
  renderMetaDescriptors,
  renderRemixLinkDescriptors,
} from "./react-router-document.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import { getModeledPromise, isThrownOutcome } from "../evaluate/promises.js";
import { getInstalledModules } from "../libraries/installed-modules.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type {
  CapturedRouterState,
  ContextDefinition,
  ExternalValueProvider,
  ModuleRecord,
  StaticElementValue,
  StaticListValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticRenderResult,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import { findRouteFile, routeIdFromFile, splitPathname } from "./route-files.js";
import { element, emptyStub, hostElement, nativeFunction, omitProps, stubValue } from "./stubs.js";

const SCROLL_RESTORATION_PROPS: ReadonlySet<string> = new Set(["getKey", "storageKey"]);

interface ReactRouterRouteOptions {
  /**
   * Module that boots the router. Either an entry with a root render call
   * (`<RouterProvider router={router} />` or `<BrowserRouter><Routes>…`) or a
   * framework-mode `app/routes.ts` whose default export lists the routes.
   * Without one, the app directory decides: its `routes.ts` when present,
   * otherwise the `routes/` file convention (Remix v2, `@react-router/fs-routes`).
   */
  routesModule?: string;
  /** Framework-mode app directory; `app` by default. */
  appDirectory?: string;
}

/**
 * Everything the static side needs to stand in for React Router for one URL:
 * an `ExternalValueProvider` that models the router's exports, and the route
 * renderer for framework-mode projects.
 */
interface ReactRouterModel {
  pathname: string;
  /** Captured data-router state for this URL, when a runtime capture supplied one. */
  observed: ObservedRouterState | null;
  externalValues: ExternalValueProvider;
  /**
   * Filled in by the framework-mode renderer once routes are matched; the
   * `HydratedRouter`, `Meta` and `Links` stubs read from it. Stays empty for
   * SPA entries, where those components render nothing statically knowable.
   */
  framework: FrameworkState;
  /** `HydratedRouter` from `react-router/dom`, for the default client entry. */
  hydratedRouter: StubComponent;
  /** `RemixBrowser` from `@remix-run/react`, for the default client entry of a Remix project. */
  remixBrowser: StubComponent;
}

interface FrameworkState extends FrameworkDocument {
  /** The matched route tree `HydratedRouter` mounts (root `RenderedRoute` inwards). */
  routeTree: StaticValue | null;
  /** Every route below the root, as the server matches manifest requests against them. */
  routes: RouteRecord[] | null;
  /** `react-router.config.ts` settings; null outside framework mode. */
  config: FrameworkConfig | null;
  /** Dev-server URLs of the matched route modules, root first, as `<Scripts>` preloads them. */
  routeModuleUrls: string[];
  /** Where the rendered `<Link>`s and `<Form>`s point, which eager route discovery fetches manifest patches for. */
  discoveredTargets: DiscoveredTargets;
  /** Whether hydration is followed by a router re-render, which drops the `<Scripts>` preloads. */
  isRerenderedAfterHydration: UncertainFlag;
  /** The client entry or a matched module imports a side-effect stylesheet the Vite dev server inlines, which Remix's `<Links>` keeps. */
  hasInlinedCriticalCss: boolean;
  /** `remix.config.*` drives the esbuild-based compiler (dev live reload over a socket, no critical CSS). */
  isClassicCompiler: boolean;
}

interface DiscoveredTargets {
  pathnames: Set<string>;
  hasDynamicPathname: boolean;
}

interface UncertainFlag {
  value: boolean | null;
  /** Why the value is null. */
  reason: string;
}

/** A link target `resolveTo` resolved against its route, or null when it is not static. */
interface ResolvedTarget {
  pathname: string;
  href: string;
}

/** `Link`/`Form` targets that React Router marks with `data-discover` for the fog-of-war observer. */
interface DiscoveryRegistry {
  register: (target: ResolvedTarget | null) => void;
}

/** Config flags the document components branch on; null when not static. */
interface FrameworkConfig {
  /** `ssr`; `false` is SPA mode. */
  isSsr: boolean | null;
  /** `routeDiscovery.mode === "lazy"` under SSR: the route manifest is fetched on demand. */
  isFogOfWar: boolean | null;
  /** `future.unstable_subResourceIntegrity`. */
  hasSubResourceIntegrity: boolean | null;
  /** Remix's `future.v3_singleFetch`; `RemixBrowser` renders an extra fragment for it. */
  isSingleFetch: boolean | null;
}

const CLIENT_ENTRY_NAMES = [
  "entry.client.tsx",
  "entry.client.jsx",
  "entry.client.ts",
  "entry.client.js",
];
const ROOT_MODULE_NAMES = ["root.tsx", "root.jsx", "root.ts", "root.js"];
const ROOT_ROUTE_ID = "root";
const CONFIG_MODULE_NAMES = [
  "react-router.config.ts",
  "react-router.config.js",
  "react-router.config.mjs",
  "remix.config.js",
  "remix.config.mjs",
  "remix.config.ts",
];
const VITE_CONFIG_MODULE_NAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
];
const VITE_PACKAGE = "vite";
const REMIX_DEV_PACKAGE = "@remix-run/dev";
const REMIX_VITE_PLUGIN_NAME = "remix";
const MDX_ROUTE_MODULE = /\.mdx?$/;
const REMIX_CONFIG_PREFIX = "remix.config.";

const REMIX_REACT_PACKAGE = "@remix-run/react";
const ROUTER_PACKAGES = new Set([
  "react-router",
  "react-router/dom",
  "react-router-dom",
  REMIX_REACT_PACKAGE,
]);
const ROUTE_CONFIG_PACKAGE = "@react-router/dev/routes";

/**
 * Mirrors React Router's `RouteContext` (displayName `Route`). The static
 * provider value is `{ outlet, params, id, pathnameBase }`: the element for the
 * matched child route, the params accumulated down to this match, the route id
 * that keys loader data, and the URL prefix descendant `<Routes>` match after.
 */
const ROUTE_CONTEXT: ContextDefinition = {
  name: "RouteContext",
  displayName: "Route",
  defaultValue: NULL_VALUE,
  location: null,
};

/**
 * Mirrors `LocationContext` (displayName `Location`): every router component
 * provides it, and `useInRouterContext` is whether it is provided.
 */
const LOCATION_CONTEXT: ContextDefinition = {
  name: "LocationContext",
  displayName: "Location",
  defaultValue: NULL_VALUE,
  location: null,
};

/**
 * `DataRouterStateContext`: the router's state, republished on every state
 * update so that `<Scripts>` re-renders (and drops its preloads) when route
 * discovery patches the manifest.
 */
const DATA_ROUTER_STATE_CONTEXT: ContextDefinition = {
  name: "DataRouterStateContext",
  displayName: "DataRouterState",
  defaultValue: NULL_VALUE,
  location: null,
};

/** `FrameworkContext`: the manifest, route modules and the critical CSS `HydratedRouter` clears once hydrated. */
const FRAMEWORK_CONTEXT: ContextDefinition = {
  name: "FrameworkContext",
  displayName: "FrameworkContext",
  defaultValue: NULL_VALUE,
  location: null,
};

/** Mirrors `AwaitContext` (displayName `Await`): the tracked promise whose `_data` `useAsyncValue` reads. */
const AWAIT_CONTEXT: ContextDefinition = {
  name: "AwaitContext",
  displayName: "Await",
  defaultValue: NULL_VALUE,
  location: null,
};

/** `RemixContext` (displayName `Remix`), provided by `RemixBrowser` around the router. */
const REMIX_CONTEXT: ContextDefinition = {
  name: "RemixContext",
  displayName: "Remix",
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

/** `OutletContext` has no displayName in React Router, so it shows up as an anonymous provider. */
const OUTLET_CONTEXT: ContextDefinition = {
  name: "OutletContext",
  displayName: null,
  defaultValue: NULL_VALUE,
  location: null,
};

export interface RouteRecord {
  /**
   * The router's route id: an explicit `id`, the file path without extension in
   * framework mode, or the `"0-1"` tree path data routers assign. Keys loader data.
   */
  id: string | null;
  path: string | null;
  index: boolean;
  element: StaticValue | null;
  component: StaticValue | null;
  file: string | null;
  children: RouteRecord[];
  /** Set when the route object could not be read statically (spread, lazy, dynamic). */
  uncertainty: string | null;
}

const readString = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const isDefined = (value: StaticValue): boolean =>
  !(value.kind === "primitive" && (value.value === undefined || value.value === null));

const uncertainRoute = (uncertainty: string): RouteRecord => ({
  id: null,
  path: null,
  index: false,
  element: null,
  component: null,
  file: null,
  children: [],
  uncertainty,
});

/** Evaluates a route's `lazy` function as the router does when it awaits the route module; null when unavailable. */
interface LazyResolver {
  (lazy: StaticValue): StaticValue;
}

interface RouteContent {
  element: StaticValue | null;
  component: StaticValue | null;
  uncertainty: string | null;
}

interface RoutePath {
  path: string | null;
  uncertainty: string | null;
}

/** A route's `path`: a literal, absent, or (a computed value) unreadable, in which case any URL may match it. */
const readRoutePath = (fields: StaticObjectValue): RoutePath => {
  const value = getObjectProperty(fields, "path");
  const literal = readString(value);
  if (literal !== null || !isDefined(value)) return { path: literal, uncertainty: null };
  return { path: null, uncertainty: `route path is ${describeValue(value)}` };
};

/** Route module fields (`element`, `Component`), taking `lazy`'s awaited module as a fallback source. */
const readRouteContent = (
  fields: StaticObjectValue,
  lazy: StaticValue,
  resolveLazy: LazyResolver | null,
): RouteContent => {
  const own = {
    element: getObjectProperty(fields, "element"),
    component: getObjectProperty(fields, "Component"),
  };
  if (!isDefined(lazy)) {
    return {
      element: isDefined(own.element) ? own.element : null,
      component: isDefined(own.component) ? own.component : null,
      uncertainty: null,
    };
  }
  const lazyModule = resolveLazy && lazy.kind === "function" ? resolveLazy(lazy) : null;
  if (!lazyModule || lazyModule.kind !== "object") {
    return { element: null, component: null, uncertainty: "route is loaded lazily" };
  }
  const element = isDefined(own.element) ? own.element : getObjectProperty(lazyModule, "element");
  const component = isDefined(own.component)
    ? own.component
    : getObjectProperty(lazyModule, "Component");
  return {
    element: isDefined(element) ? element : null,
    component: isDefined(component) ? component : null,
    uncertainty: null,
  };
};

/** `convertRoutesToDataRoutes`: `route.id`, else the index path from the root joined with `-`. */
const readRouteId = (fields: StaticObjectValue, treePath: number[]): string => {
  const explicit = readString(getObjectProperty(fields, "id"));
  if (explicit !== null) return explicit;
  const file = readString(getObjectProperty(fields, "file"));
  return file === null ? treePath.join("-") : routeIdFromFile(file);
};

const readRouteObject = (
  value: StaticValue,
  resolveLazy: LazyResolver | null,
  treePath: number[],
): RouteRecord => {
  if (value.kind !== "object") return uncertainRoute(`route is ${value.kind}`);
  const hasSpread = value.entries.some((entry) => entry.kind === "spread");
  const content = readRouteContent(value, getObjectProperty(value, "lazy"), resolveLazy);
  const routePath = readRoutePath(value);
  return {
    id: readRouteId(value, treePath),
    path: routePath.path,
    index: getTruthiness(getObjectProperty(value, "index")) === true,
    element: content.element,
    component: content.component,
    file: readString(getObjectProperty(value, "file")),
    children: readRouteList(getObjectProperty(value, "children"), resolveLazy, treePath),
    uncertainty: hasSpread
      ? "route object has a spread"
      : (routePath.uncertainty ?? content.uncertainty),
  };
};

const readRouteList = (
  value: StaticValue,
  resolveLazy: LazyResolver | null,
  parentPath: number[] = [],
): RouteRecord[] => {
  if (value.kind === "list") {
    return value.items.map((item, index) =>
      readRouteObject(item, resolveLazy, [...parentPath, index]),
    );
  }
  if (value.kind === "primitive") return [];
  return [uncertainRoute(`route list is ${value.kind}`)];
};

/** `Children.forEach` order: nested arrays are flattened into one running index. */
const flattenChildren = (value: StaticValue): StaticValue[] =>
  value.kind === "list" ? value.items.flatMap(flattenChildren) : [value];

/** `<Route path element>` elements nested under `<Routes>` are routes too (`createRoutesFromChildren`). */
const readRouteElements = (
  value: StaticValue,
  resolveLazy: LazyResolver | null,
  parentPath: number[] = [],
): RouteRecord[] => {
  const routes: RouteRecord[] = [];
  flattenChildren(value).forEach((item, index) => {
    const treePath = [...parentPath, index];
    if (item.kind === "element" && item.type.kind === "stub" && item.type.stub === ROUTE_STUB) {
      const props = item.props;
      const content = readRouteContent(props, getObjectProperty(props, "lazy"), resolveLazy);
      const routePath = readRoutePath(props);
      routes.push({
        id: readRouteId(props, treePath),
        path: routePath.path,
        index: getTruthiness(getObjectProperty(props, "index")) === true,
        element: content.element,
        component: content.component,
        file: null,
        children: readRouteElements(getObjectProperty(props, "children"), resolveLazy, treePath),
        uncertainty: routePath.uncertainty ?? content.uncertainty,
      });
    } else if (item.kind === "element" && item.type.kind === "fragment") {
      routes.push(
        ...readRouteElements(getObjectProperty(item.props, "children"), resolveLazy, treePath),
      );
    } else if (item.kind !== "primitive") {
      routes.push(uncertainRoute(`route child is ${item.kind}`));
    }
  });
  return routes;
};

type RouteParams = Record<string, string>;

interface MatchedRouteModule {
  module: ModuleRecord;
  params: RouteParams;
  routeId: string;
}

interface RouteMatch {
  route: RouteRecord;
  /** Params of this route and every ancestor, as `useParams` reports them. */
  params: RouteParams;
  /** URL segments matched by this route and its ancestors, excluding a splat. */
  consumedSegments: number;
}

interface RankedMatch {
  chain: RouteMatch[];
  score: number;
}

const STATIC_SEGMENT_SCORE = 10;
const DYNAMIC_SEGMENT_SCORE = 3;
const INDEX_ROUTE_SCORE = 2;
const SPLAT_PENALTY = -2;

interface OwnPathMatch {
  rest: string[];
  score: number;
  params: RouteParams;
  consumedSegments: number;
}

/** Matches one route's own `path` against the remaining URL segments. */
const matchOwnPath = (routePath: string | null, remaining: string[]): OwnPathMatch | null => {
  if (routePath === null) return { rest: remaining, score: 0, params: {}, consumedSegments: 0 };
  const params: RouteParams = {};
  let score = 0;
  let cursor = 0;
  for (const segment of splitPathname(routePath)) {
    if (segment === "*") {
      params["*"] = remaining.slice(cursor).join("/");
      return { rest: [], score: score + SPLAT_PENALTY, params, consumedSegments: cursor };
    }
    const optional = segment.endsWith("?");
    const name = optional ? segment.slice(0, -1) : segment;
    const current = remaining[cursor];
    if (current === undefined) {
      if (optional) continue;
      return null;
    }
    if (name.startsWith(":")) {
      params[name.slice(1)] = decodeURIComponent(current);
      score += DYNAMIC_SEGMENT_SCORE;
      cursor += 1;
    } else if (name === current) {
      score += STATIC_SEGMENT_SCORE;
      cursor += 1;
    } else if (!optional) {
      return null;
    }
  }
  return { rest: remaining.slice(cursor), score, params, consumedSegments: cursor };
};

const matchRoutes = (
  routes: RouteRecord[],
  remaining: string[],
  inherited: RouteParams,
  consumedBefore = 0,
): RankedMatch[] => {
  const matches: RankedMatch[] = [];
  for (const route of routes) {
    const own = matchOwnPath(route.path, remaining);
    if (!own) continue;
    const params = { ...inherited, ...own.params };
    const consumedSegments = consumedBefore + own.consumedSegments;
    const match: RouteMatch = { route, params, consumedSegments };
    if (route.index) {
      if (own.rest.length === 0) {
        matches.push({ chain: [match], score: own.score + INDEX_ROUTE_SCORE });
      }
      continue;
    }
    if (route.children.length === 0) {
      if (own.rest.length === 0) matches.push({ chain: [match], score: own.score });
      continue;
    }
    for (const child of matchRoutes(route.children, own.rest, params, consumedSegments)) {
      matches.push({ chain: [match, ...child.chain], score: own.score + child.score });
    }
    if (own.rest.length === 0 && route.path !== null) {
      matches.push({ chain: [match], score: own.score });
    }
  }
  return matches;
};

/** What an enclosing route already matched, as `useRoutes` reads it from `RouteContext`. */
interface ParentMatch {
  params: RouteParams;
  pathnameBase: string;
}

const ROOT_PARENT_MATCH: ParentMatch = { params: {}, pathnameBase: "/" };

const bestMatch = (
  routes: RouteRecord[],
  pathname: string,
  parent: ParentMatch,
): RouteMatch[] | null => {
  const parentSegmentCount = splitPathname(parent.pathnameBase).length;
  const matches = matchRoutes(
    routes,
    splitPathname(pathname).slice(parentSegmentCount),
    parent.params,
    parentSegmentCount,
  );
  if (matches.length === 0) return null;
  matches.sort((left, right) => right.score - left.score);
  return matches[0].chain;
};

const paramsValue = (params: RouteParams): StaticValue =>
  objectFromRecord(
    Object.fromEntries(
      Object.entries(params).map(([name, value]) => [name, primitiveValue(value)]),
    ),
  );

/**
 * `RenderedRoute` is the function component React Router renders per match; it
 * provides `RouteContext` with the outlet for the next match.
 */
const routeContextProvider = (
  routeContext: StaticValue,
  children: StaticValue,
): StaticElementValue =>
  element(
    { kind: "context-provider", context: ROUTE_CONTEXT, displayName: ROUTE_CONTEXT.displayName },
    objectFromRecord({ value: routeContext, children }),
  );

const RENDERED_ROUTE_STUB: StubComponent = {
  displayName: "RenderedRoute",
  render: (props) =>
    routeContextProvider(
      getObjectProperty(props, "routeContext"),
      getObjectProperty(props, "children"),
    ),
};

/**
 * React Router 6.4 introduced data routers and with them `RenderedRoute`; up to
 * 6.3 `_renderMatches` created the `RouteContext` provider directly.
 */
const hasRenderedRoute = (rootDirectory: string): boolean => {
  const installed = getInstalledModules(rootDirectory).load("react-router");
  return installed === null || "RouterProvider" in installed;
};

const renderedRoute = (
  outlet: StaticValue,
  params: RouteParams,
  routeId: string | null,
  pathnameBase: string,
  children: StaticValue,
  withRenderedRoute = true,
): StaticElementValue => {
  const routeContext = objectFromRecord({
    outlet,
    params: paramsValue(params),
    id: routeId === null ? UNDEFINED_VALUE : primitiveValue(routeId),
    pathnameBase: primitiveValue(pathnameBase),
  });
  return withRenderedRoute
    ? element(
        { kind: "stub", stub: RENDERED_ROUTE_STUB },
        objectFromRecord({ routeContext, children }),
      )
    : routeContextProvider(routeContext, children);
};

/** The URL prefix a match consumed, which descendant `<Routes>` match relative to. */
const getPathnameBase = (pathname: string, match: RouteMatch): string =>
  `/${splitPathname(pathname).slice(0, match.consumedSegments).join("/")}`;

/**
 * Builds the element for a matched chain exactly like `_renderMatches`: each
 * match renders inside a `RenderedRoute`, innermost first, and a route without
 * an element renders its outlet directly.
 */
const composeChain = (
  chain: RouteMatch[],
  pathname: string,
  renderRoute: (route: RouteRecord, outlet: StaticValue) => StaticValue,
  withRenderedRoute = true,
): StaticValue => {
  let outlet: StaticValue = NULL_VALUE;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const match = chain[index];
    if (match.route.uncertainty) {
      outlet = unknownValue(`react-router: ${match.route.uncertainty}`);
      continue;
    }
    outlet = renderedRoute(
      outlet,
      match.params,
      match.route.id,
      getPathnameBase(pathname, match),
      renderRoute(match.route, outlet),
      withRenderedRoute,
    );
  }
  return outlet;
};

const renderDataRoute = (route: RouteRecord, outlet: StaticValue): StaticValue => {
  if (route.element) return route.element;
  if (route.component) return element(toElementType(route.component, null), objectValue());
  return outlet;
};

/**
 * Routes whose path is unknown (a spread of a computed list, a dynamic
 * object, a computed `path`) may rank above any statically matched route, so a
 * match found next to them, at any depth under matching parents, is only the
 * preferred alternative.
 */
const collectUnreadableRoutes = (routes: RouteRecord[], remaining: string[]): RouteRecord[] =>
  routes.flatMap((route) => {
    if (route.uncertainty !== null && route.path === null) return [route];
    const own = matchOwnPath(route.path, remaining);
    return own ? collectUnreadableRoutes(route.children, own.rest) : [];
  });

const renderMatchedRoutes = (
  routes: RouteRecord[],
  pathname: string,
  parent: ParentMatch,
  withRenderedRoute: boolean,
): StaticValue => {
  const remaining = splitPathname(pathname).slice(splitPathname(parent.pathnameBase).length);
  const unreadable = collectUnreadableRoutes(routes, remaining);
  const chain = bestMatch(routes, pathname, parent);
  if (!chain) {
    return unknownValue(
      unreadable.length > 0
        ? "react-router: routes could not be read statically"
        : `react-router: no route matches ${pathname}`,
    );
  }
  const matched = composeChain(chain, pathname, renderDataRoute, withRenderedRoute);
  if (unreadable.length === 0) return matched;
  return branchValue(
    [matched, unknownValue(`react-router: ${unreadable[0].uncertainty}`)],
    `${unreadable.length} route(s) could not be read statically and may also match ${pathname}`,
  );
};

const readRouteContext = (
  tools: StubRenderTools,
  field: "outlet" | "params" | "id",
): StaticValue => {
  const routeContext = tools.readContext(ROUTE_CONTEXT);
  if (routeContext.kind !== "object") {
    return unknownValue(`react-router: ${field} read outside a matched route`);
  }
  return getObjectProperty(routeContext, field);
};

/**
 * Descendant `<Routes>` match the URL left over by the enclosing route, and
 * their matches inherit its params; top-level `<Routes>` see the whole URL.
 */
const readParentMatch = (tools: StubRenderTools): ParentMatch | null => {
  const routeContext = tools.readContext(ROUTE_CONTEXT);
  if (routeContext.kind !== "object") return ROOT_PARENT_MATCH;
  const pathnameBase = readString(getObjectProperty(routeContext, "pathnameBase"));
  const params = getObjectProperty(routeContext, "params");
  if (pathnameBase === null || params.kind !== "object") return null;
  const inherited: RouteParams = {};
  for (const entry of params.entries) {
    if (entry.kind !== "property") return null;
    const value = readString(entry.value);
    if (value === null) return null;
    inherited[entry.key] = value;
  }
  return { params: inherited, pathnameBase };
};

const ROUTE_STUB: StubComponent = {
  displayName: "Route",
  render: () => NULL_VALUE,
};

/** `useOutlet`: a truthy outlet renders inside an `OutletContext` provider; a null one renders as is. */
const outletValue = (tools: StubRenderTools, context: StaticValue): StaticValue => {
  const outlet = readRouteContext(tools, "outlet");
  const provided = element(
    { kind: "context-provider", context: OUTLET_CONTEXT, displayName: null },
    objectFromRecord({ value: context, children: outlet }),
  );
  switch (getTruthiness(outlet)) {
    case true:
      return provided;
    case false:
      return outlet;
    default:
      return branchValue([provided, outlet], "react-router: outlet is not known statically");
  }
};

const OUTLET_STUB: StubComponent = {
  displayName: "Outlet",
  render: (props, tools) => outletValue(tools, getObjectProperty(props, "context")),
};

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i;

interface LinkPrefetch {
  /** Null when only the browser decides (viewport visibility, non-static props). */
  isPrefetching: boolean | null;
  reason: string | null;
}

const PREFETCH_PROPS: ReadonlySet<string> = new Set(["prefetch"]);

/** `<PrefetchPageLinks>` lists the modules and data of a page from the build manifest. */
const PREFETCH_PAGE_LINKS_STUB: StubComponent = {
  displayName: "PrefetchPageLinks",
  render: () => unknownValue("react-router: prefetch links come from the build manifest"),
};

/**
 * `usePrefetchBehavior`: `prefetch="render"` prefetches after mount, `intent`
 * only after hover/focus, `viewport` once the anchor is visible; absolute
 * URLs never prefetch.
 */
const readLinkPrefetch = (props: StaticObjectValue): LinkPrefetch => {
  const prefetch = getObjectProperty(props, "prefetch");
  const mode = isDefined(prefetch) ? readString(prefetch) : "none";
  if (mode === null) return { isPrefetching: null, reason: "`prefetch` is not a static string" };
  if (mode === "none" || mode === "intent") return { isPrefetching: false, reason: null };
  const to = getObjectProperty(props, "to");
  const target = readString(to);
  const isAbsolute =
    to.kind === "object" ? false : target === null ? null : ABSOLUTE_URL.test(target);
  if (isAbsolute === null) return { isPrefetching: null, reason: "`to` is not a static string" };
  if (isAbsolute) return { isPrefetching: false, reason: null };
  return mode === "render"
    ? { isPrefetching: true, reason: null }
    : { isPrefetching: null, reason: "viewport prefetch waits for the IntersectionObserver" };
};

const prefetchPageLinks = (href: StaticValue): StaticValue =>
  element({ kind: "stub", stub: PREFETCH_PAGE_LINKS_STUB }, objectFromRecord({ page: href }));

const fragmentOf = (children: StaticValue[]): StaticElementValue =>
  element({ kind: "fragment" }, objectFromRecord({ children: listValue(children) }));

const resolvePathnameFrom = (relativePath: string, fromPathname: string): string => {
  const segments = fromPathname.replace(/\/+$/, "").split("/");
  for (const segment of relativePath.split("/")) {
    if (segment === "..") {
      if (segments.length > 1) segments.pop();
    } else if (segment !== ".") {
      segments.push(segment);
    }
  }
  return segments.length > 1 ? segments.join("/") : "/";
};

/**
 * `resolveTo` for a `to`/`action` string or `{ pathname }` object: relative
 * paths resolve against the enclosing route, `..` walks up the route matches
 * (which needs the ancestor list this context does not carry, so stays unknown).
 */
const resolveTarget = (
  target: StaticValue,
  parent: ParentMatch | null,
  locationPathname: string,
): ResolvedTarget | null => {
  if (!parent) return null;
  const targetPathname = target.kind === "object" ? getObjectProperty(target, "pathname") : target;
  if (!isDefined(targetPathname)) {
    return { pathname: locationPathname, href: locationPathname };
  }
  const text = readString(targetPathname);
  if (text === null) return null;
  const restIndex = text.search(/[?#]/);
  const toPathname = restIndex === -1 ? text : text.slice(0, restIndex);
  const rest = restIndex === -1 ? "" : text.slice(restIndex);
  if (toPathname.startsWith("..")) return null;
  const pathname =
    toPathname === ""
      ? text === ""
        ? parent.pathnameBase
        : locationPathname
      : toPathname.startsWith("/")
        ? resolvePathnameFrom(toPathname.slice(1), "/")
        : resolvePathnameFrom(toPathname, parent.pathnameBase);
  return { pathname, href: `${pathname}${rest}` };
};

const createLinkStubs = (
  discovery: DiscoveryRegistry,
  locationPathname: string,
): {
  link: StubComponent;
  navLink: StubComponent;
  form: StubComponent;
  fetcherForm: StubComponent;
} => {
  const discover = (
    target: StaticValue,
    tools: StubRenderTools,
    discoverProp: StaticValue,
  ): ResolvedTarget | null => {
    const resolved = resolveTarget(target, readParentMatch(tools), locationPathname);
    const mode = isDefined(discoverProp) ? readString(discoverProp) : "render";
    if (mode === null) {
      discovery.register(null);
    } else if (mode === "render") {
      discovery.register(resolved);
    }
    return resolved;
  };
  const link: StubComponent = {
    displayName: "Link",
    tag: ForwardRefTag,
    render: (props, tools) => {
      const to = getObjectProperty(props, "to");
      const absoluteHref = readString(to);
      const isAbsolute = absoluteHref !== null && ABSOLUTE_URL.test(absoluteHref);
      const resolved = isAbsolute
        ? null
        : discover(to, tools, getObjectProperty(props, "discover"));
      const href = isAbsolute
        ? primitiveValue(absoluteHref)
        : resolved
          ? primitiveValue(resolved.href)
          : unknownPrimitiveValue("string", "href is resolved by the router");
      const anchor = element(
        { kind: "host", tagName: "a" },
        objectFromRecord({ href, children: getObjectProperty(props, "children") }),
      );
      const { isPrefetching, reason } = readLinkPrefetch(props);
      if (isPrefetching === false) return anchor;
      const prefetching = fragmentOf([anchor, prefetchPageLinks(href)]);
      return isPrefetching
        ? prefetching
        : branchValue([anchor, prefetching], `react-router: <Link> ${reason}`);
    },
  };
  const navLink: StubComponent = {
    displayName: "NavLink",
    tag: ForwardRefTag,
    render: (props) => {
      const children = getObjectProperty(props, "children");
      return element(
        { kind: "stub", stub: link },
        objectValue([
          { kind: "spread", value: omitProps(props, NAV_LINK_PROPS) },
          {
            kind: "property",
            key: "children",
            value:
              children.kind === "function"
                ? unknownValue("NavLink children render function")
                : children,
          },
        ]),
      );
    },
  };
  const form: StubComponent = {
    displayName: "Form",
    tag: ForwardRefTag,
    render: (props, tools) => {
      const action = getObjectProperty(props, "action");
      discover(
        isDefined(action) ? action : primitiveValue("."),
        tools,
        getObjectProperty(props, "discover"),
      );
      return element(
        { kind: "host", tagName: "form" },
        objectFromRecord({ children: getObjectProperty(props, "children") }),
      );
    },
  };
  const fetcherForm: StubComponent = {
    displayName: "fetcher.Form",
    tag: ForwardRefTag,
    render: (props) =>
      element(
        { kind: "stub", stub: form },
        objectValue([
          { kind: "spread", value: props },
          { kind: "property", key: "navigate", value: primitiveValue(false) },
        ]),
      ),
  };
  return { link, navLink, form, fetcherForm };
};

const NAV_LINK_PROPS = new Set(["className", "style", "end", "caseSensitive", "children"]);

/**
 * `@remix-run/react` v2 wraps react-router-dom's `Link`/`NavLink` in
 * `<>{inner}{shouldPrefetch && !isAbsolute ? <PrefetchPageLinks /> : null}</>`
 * and `Form` in a plain pass-through.
 */
const remixLinkStub = (inner: StubComponent): StubComponent => ({
  displayName: inner.displayName,
  tag: ForwardRefTag,
  render: (props) => {
    const innerElement = element({ kind: "stub", stub: inner }, omitProps(props, PREFETCH_PROPS));
    const { isPrefetching, reason } = readLinkPrefetch(props);
    const page = unknownPrimitiveValue("string", "href is resolved by the router");
    const trailing =
      isPrefetching === null
        ? branchValue(
            [NULL_VALUE, prefetchPageLinks(page)],
            `remix: <${inner.displayName}> ${reason}`,
          )
        : isPrefetching
          ? prefetchPageLinks(page)
          : NULL_VALUE;
    return fragmentOf([innerElement, trailing]);
  },
});

const remixFormStub = (inner: StubComponent): StubComponent => ({
  displayName: "Form",
  tag: ForwardRefTag,
  render: (props) => element({ kind: "stub", stub: inner }, props),
});

const readAsyncValue = (tools: StubRenderTools): StaticValue => {
  const awaited = tools.readContext(AWAIT_CONTEXT);
  return awaited.kind === "object" ? getObjectProperty(awaited, "_data") : UNDEFINED_VALUE;
};

const RESOLVE_AWAIT_STUB: StubComponent = {
  displayName: "ResolveAwait",
  render: (props, tools) => {
    const children = getObjectProperty(props, "children");
    const isRenderFunction = children.kind === "function" || children.kind === "native-function";
    return fragmentOf([
      isRenderFunction ? tools.call(children, [readAsyncValue(tools)]) : children,
    ]);
  },
};

const awaitProvider = (data: StaticValue, children: StaticValue): StaticElementValue =>
  element(
    { kind: "context-provider", context: AWAIT_CONTEXT, displayName: AWAIT_CONTEXT.displayName },
    objectFromRecord({ value: objectFromRecord({ _data: data }), children }),
  );

/**
 * `<Await>` renders `AwaitErrorBoundary` > `AwaitContext.Provider` > `ResolveAwait`
 * once `resolve` settles; a rejection renders `errorElement` instead when given
 * (and throws to the route error boundary otherwise), which only the runtime decides.
 */
const AWAIT_STUB: StubComponent = {
  displayName: "Await",
  render: (props) => {
    const resolve = getObjectProperty(props, "resolve");
    const errorElement = getObjectProperty(props, "errorElement");
    const promise = getModeledPromise(resolve);
    const outcome = promise ? promise.settled : resolve;
    const isResolved = outcome !== null && outcome.kind !== "unknown";
    const isRejected = outcome !== null && isThrownOutcome(outcome);
    const hasErrorElement = getTruthiness(errorElement);
    const resolved = awaitProvider(
      isResolved ? outcome : unknownValue("react-router: <Await> resolve settles only at runtime"),
      element(
        { kind: "stub", stub: RESOLVE_AWAIT_STUB },
        objectFromRecord({ children: getObjectProperty(props, "children") }),
      ),
    );
    const rejected = awaitProvider(UNDEFINED_VALUE, errorElement);
    if (isRejected && hasErrorElement === true) return rejected;
    if (isResolved || hasErrorElement === false) return resolved;
    return branchValue(
      [resolved, rejected],
      "react-router: <Await> resolves or rejects only at runtime",
    );
  },
};

const FETCHER_METHODS = ["submit", "load", "reset"];

/** `useFetcher()`: a fixed `Form` and imperative API around whatever fetcher state the router holds. */
const fetcherValue = (state: StaticValue, fetcherForm: StubComponent): StaticValue =>
  objectValue([
    { kind: "spread", value: state },
    { kind: "property", key: "Form", value: stubValue(fetcherForm) },
    ...FETCHER_METHODS.map((method): StaticObjectEntry => ({
      kind: "property",
      key: method,
      value: nativeFunction(method, () => UNDEFINED_VALUE),
    })),
  ]);

const createRouterFactory = (name: string): StaticValue =>
  nativeFunction(name, (args) => objectFromRecord({ routes: args[0] ?? listValue([]) }));

/**
 * `createRoutesFromChildren`: `<Route>` elements (fragments flattened) become
 * route objects whose id is the explicit `id` or the tree path joined with `-`.
 * Children that are not static elements stay in the list so the route reader
 * reports them as uncertain instead of dropping them.
 */
const routeObjectsFromElements = (
  children: StaticValue,
  parentPath: number[] = [],
): StaticListValue => {
  const items = children.kind === "list" ? children.items : [children];
  const routes: StaticValue[] = [];
  items.forEach((item, index) => {
    if (item.kind === "primitive") return;
    const treePath = [...parentPath, index];
    if (item.kind === "element" && item.type.kind === "fragment") {
      routes.push(
        ...routeObjectsFromElements(getObjectProperty(item.props, "children"), treePath).items,
      );
      return;
    }
    if (item.kind !== "element" || item.type.kind !== "stub" || item.type.stub !== ROUTE_STUB) {
      routes.push(item);
      return;
    }
    const props = item.props;
    const nestedChildren = getObjectProperty(props, "children");
    const id = getObjectProperty(props, "id");
    const errorElement = getObjectProperty(props, "errorElement");
    const errorBoundary = getObjectProperty(props, "ErrorBoundary");
    routes.push(
      objectFromRecord({
        id: getTruthiness(id) === true ? id : primitiveValue(treePath.join("-")),
        caseSensitive: getObjectProperty(props, "caseSensitive"),
        element: getObjectProperty(props, "element"),
        Component: getObjectProperty(props, "Component"),
        index: getObjectProperty(props, "index"),
        path: getObjectProperty(props, "path"),
        loader: getObjectProperty(props, "loader"),
        action: getObjectProperty(props, "action"),
        errorElement,
        ErrorBoundary: errorBoundary,
        hasErrorBoundary: primitiveValue(isDefined(errorBoundary) || isDefined(errorElement)),
        shouldRevalidate: getObjectProperty(props, "shouldRevalidate"),
        handle: getObjectProperty(props, "handle"),
        lazy: getObjectProperty(props, "lazy"),
        children: isDefined(nestedChildren)
          ? routeObjectsFromElements(nestedChildren, treePath)
          : UNDEFINED_VALUE,
      }),
    );
  });
  return listValue(routes);
};

/** Values only the running router knows; each is a hook returning an explicit unknown. */
const RUNTIME_ONLY_HOOKS = new Set([
  "useLoaderData",
  "useRouteLoaderData",
  "useActionData",
  "useMatches",
  "useMatch",
  "useNavigation",
  "useRevalidator",
  "unstable_useRoute",
  "useFetchers",
  "useRouteError",
  "useHref",
  "useResolvedPath",
  "useBlocker",
  "useBeforeUnload",
  "useSubmit",
  "useFormAction",
  "useAsyncError",
  "useViewTransitionState",
]);

const runtimeOnlyHook = (importedName: string): StaticValue =>
  nativeFunction(importedName, () =>
    unknownValue(`react-router ${importedName}() is only known at runtime`),
  );

/** Hooks over data-router state, answered from the capture of this URL. */
const observedHookValue = (
  importedName: string,
  observed: ObservedRouterState,
): StaticValue | null => {
  switch (importedName) {
    case "useLoaderData":
      return nativeFunction(importedName, (_args, tools) => {
        const routeId = readString(readRouteContext(tools, "id"));
        return routeId === null
          ? unknownValue("react-router useLoaderData() outside a route with a known id")
          : observed.loaderData(routeId);
      });
    case "useActionData":
      return nativeFunction(importedName, (_args, tools) => {
        const routeId = readString(readRouteContext(tools, "id"));
        return routeId === null
          ? unknownValue("react-router useActionData() outside a route with a known id")
          : observed.actionData(routeId);
      });
    case "useRouteLoaderData":
      return nativeFunction(importedName, (args) => {
        const routeId = args[0] ? readString(args[0]) : null;
        return routeId === null
          ? unknownValue("react-router useRouteLoaderData() with a dynamic route id")
          : observed.loaderData(routeId);
      });
    case "useMatches":
      return nativeFunction(importedName, () => observed.matches);
    case "unstable_useRoute":
      return nativeFunction(importedName, (args, tools) => {
        const routeId = args[0] ? readString(args[0]) : readString(readRouteContext(tools, "id"));
        if (routeId === null) {
          return unknownValue("react-router unstable_useRoute() with a dynamic route id");
        }
        return observed.isMatched(routeId)
          ? objectFromRecord({
              handle: unknownValue(`handle export of route ${routeId}`),
              loaderData: observed.loaderData(routeId),
              actionData: observed.actionData(routeId),
            })
          : UNDEFINED_VALUE;
      });
    case "useNavigation":
      return nativeFunction(importedName, () => observed.navigation);
    case "useRevalidator":
      return nativeFunction(importedName, () =>
        objectFromRecord({
          revalidate: nativeFunction("revalidate", () => UNDEFINED_VALUE),
          state: observed.revalidation,
        }),
      );
    case "useFetchers":
      return nativeFunction(importedName, () => observed.fetchers);
    default:
      return null;
  }
};

interface RouteLocation {
  pathname: string;
  search: string;
  hash: string;
}

const parseRouteLocation = (route: string): RouteLocation => {
  const { pathname, search, hash } = new URL(route, "http://localhost");
  return { pathname, search, hash };
};

const locationValue = (
  location: RouteLocation,
  observed: ObservedRouterState | null,
): StaticValue =>
  observed?.location ??
  objectFromRecord({
    pathname: primitiveValue(location.pathname),
    search: primitiveValue(location.search),
    hash: primitiveValue(location.hash),
    state: NULL_VALUE,
    key: unknownValue("location key is assigned at runtime"),
  });

const provide = (
  context: ContextDefinition,
  value: StaticValue,
  children: StaticValue,
): StaticElementValue =>
  element(
    { kind: "context-provider", context, displayName: context.displayName },
    objectFromRecord({ value, children }),
  );

const withinRouter = (children: StaticValue, location: StaticValue): StaticElementValue =>
  provide(
    LOCATION_CONTEXT,
    objectFromRecord({ location, navigationType: primitiveValue("POP") }),
    children,
  );

/**
 * The router hooks of one location. `useLocation` returns the context's object,
 * `useNavigate` a callback memoized on the pathname, and `useSearchParams` a
 * pair memoized on `location.search`, so all three keep their identity across
 * renders like the real hooks do.
 */
const createRouterHookValues = (
  location: StaticValue,
  search: string,
  observed: ObservedRouterState | null,
  fetcherForm: StubComponent,
): ((importedName: string) => StaticValue | null) => {
  const navigate = nativeFunction("navigate", () => UNDEFINED_VALUE);
  const setSearchParams = nativeFunction("setSearchParams", () => UNDEFINED_VALUE);
  const searchParamsByDefaults = new Map<string, StaticValue>();
  /** `useSearchParams(defaultInit)`: the URL's query, with default keys the URL lacks appended after it. */
  const searchParamsValue = (defaultInit: StaticValue | undefined): StaticValue => {
    const defaultQuery =
      defaultInit === undefined ? "" : getSearchParamsString(createSearchParamsValue(defaultInit));
    if (defaultQuery === null) {
      return unknownValue("react-router useSearchParams() with a dynamic default init");
    }
    const memoized = searchParamsByDefaults.get(defaultQuery);
    if (memoized) return memoized;
    const params = new URLSearchParams(search);
    const defaults = new URLSearchParams(defaultQuery);
    for (const key of new Set(defaults.keys())) {
      if (params.has(key)) continue;
      for (const value of defaults.getAll(key)) params.append(key, value);
    }
    const created = listValue([
      createSearchParamsValue(primitiveValue(params.toString())),
      setSearchParams,
    ]);
    searchParamsByDefaults.set(defaultQuery, created);
    return created;
  };
  return (importedName) => {
    switch (importedName) {
      case "useParams":
        return nativeFunction(importedName, (_args, tools) => readRouteContext(tools, "params"));
      case "useOutlet":
        return nativeFunction(importedName, ([context = UNDEFINED_VALUE], tools) =>
          outletValue(tools, context),
        );
      case "useOutletContext":
        return nativeFunction(importedName, (_args, tools) => tools.readContext(OUTLET_CONTEXT));
      case "useAsyncValue":
        return nativeFunction(importedName, (_args, tools) => readAsyncValue(tools));
      case "useLocation":
        return nativeFunction(importedName, () => location);
      case "useSearchParams":
        return nativeFunction(importedName, (args) => searchParamsValue(args[0]));
      case "useNavigate":
        return nativeFunction(importedName, () => navigate);
      case "useNavigationType":
        return nativeFunction(importedName, () => primitiveValue("POP"));
      case "useInRouterContext":
        return nativeFunction(importedName, (_args, tools) =>
          primitiveValue(tools.readContext(LOCATION_CONTEXT).kind !== "primitive"),
        );
      case "useFetcher":
        return nativeFunction(importedName, () =>
          fetcherValue(
            observed?.fetcher ??
              unknownValue("react-router fetcher state is only known at runtime"),
            fetcherForm,
          ),
        );
      default:
        if (!RUNTIME_ONLY_HOOKS.has(importedName)) return null;
        return (
          (observed && observedHookValue(importedName, observed)) ?? runtimeOnlyHook(importedName)
        );
    }
  };
};

const routeConfigValue = (name: string): StaticValue | null => {
  switch (name) {
    case "route":
      return nativeFunction(name, (args) => {
        const [routePath, file, third, fourth] = args;
        const children = fourth ?? (third?.kind === "list" ? third : undefined);
        return objectFromRecord({
          path: routePath ?? NULL_VALUE,
          file: file ?? NULL_VALUE,
          children: children ?? listValue([]),
        });
      });
    case "index":
      return nativeFunction(name, (args) =>
        objectFromRecord({ index: primitiveValue(true), file: args[0] ?? NULL_VALUE }),
      );
    case "layout":
      return nativeFunction(name, (args) => {
        const [file, second, third] = args;
        const children = third ?? (second?.kind === "list" ? second : undefined);
        return objectFromRecord({ file: file ?? NULL_VALUE, children: children ?? listValue([]) });
      });
    case "prefix":
      return nativeFunction(name, (args) => {
        const [prefix, routes] = args;
        const prefixString = prefix ? readString(prefix) : null;
        if (prefixString === null || !routes || routes.kind !== "list") {
          return unknownValue("react-router prefix() with dynamic arguments");
        }
        return listValue(
          routes.items.map((route) => {
            if (route.kind !== "object") return route;
            const own = readString(getObjectProperty(route, "path"));
            const joined = own === null ? prefixString : `${prefixString}/${own}`;
            return objectValue([
              { kind: "spread", value: route },
              { kind: "property", key: "path", value: primitiveValue(joined) },
            ]);
          }),
        );
      });
    default:
      return null;
  }
};

const CRITICAL_CSS_REASON =
  "whether the dev server inlined critical CSS is only known from a capture";
const NO_RERENDER: UncertainFlag = { value: false, reason: "" };

const eitherFlag = (left: UncertainFlag, right: UncertainFlag): UncertainFlag => {
  if (left.value === true || right.value === true) return { value: true, reason: "" };
  return left.value === null ? left : right;
};

/** `getPathsWithAncestors`: the manifest covers a path together with every ancestor path. */
const pathsWithAncestors = (pathname: string): string[] => {
  const segments = splitPathname(pathname);
  return ["/", ...segments.map((_segment, index) => `/${segments.slice(0, index + 1).join("/")}`)];
};

const matchedRouteIds = (routes: RouteRecord[], pathname: string): Array<string | null> =>
  (bestMatch(routes, pathname, ROOT_PARENT_MATCH) ?? []).map((match) => match.route.id);

/**
 * Whether `useFogOFWarDiscovery` patches the manifest right after hydration: it
 * asks the server for the routes of every discoverable link target and only
 * re-renders the router when one is missing from the manifest the page loaded
 * with (`getPartialManifest`: the routes matching the URL and its ancestors).
 */
const discoversNewRoutes = (framework: FrameworkState, locationPathname: string): UncertainFlag => {
  const { config, routes, discoveredTargets } = framework;
  if (!config || !routes || config.isFogOfWar === false) return { value: false, reason: "" };
  if (config.isFogOfWar === null) {
    return { value: null, reason: "react-router.config `routeDiscovery` is not static" };
  }
  const knownRouteIds = new Set(
    pathsWithAncestors(locationPathname).flatMap((path) => matchedRouteIds(routes, path)),
  );
  const discoveredRouteIds = [...discoveredTargets.pathnames]
    .flatMap(pathsWithAncestors)
    .flatMap((path) => matchedRouteIds(routes, path));
  if (discoveredRouteIds.some((routeId) => routeId !== null && !knownRouteIds.has(routeId))) {
    return { value: true, reason: "" };
  }
  if (discoveredTargets.hasDynamicPathname || discoveredRouteIds.includes(null)) {
    return { value: null, reason: "a discoverable link's target route is not static" };
  }
  return { value: false, reason: "" };
};

export const createReactRouterModel = (
  route: string,
  rootDirectory: string,
  routerState: CapturedRouterState | null = null,
): ReactRouterModel => {
  const routeLocation = parseRouteLocation(route);
  const { pathname } = routeLocation;
  const observed = observeRouterState(routerState, pathname);
  const location = locationValue(routeLocation, observed);
  const withRenderedRoute = hasRenderedRoute(rootDirectory);
  const hasCriticalCss = observed?.hasCriticalCss ?? null;
  const clearsCriticalCss: UncertainFlag = { value: hasCriticalCss, reason: CRITICAL_CSS_REASON };
  const framework: FrameworkState = {
    routeTree: null,
    routes: null,
    meta: null,
    links: null,
    config: null,
    routeModuleUrls: [],
    discoveredTargets: { pathnames: new Set(), hasDynamicPathname: false },
    isRerenderedAfterHydration: clearsCriticalCss,
    hasInlinedCriticalCss: false,
    isClassicCompiler: false,
  };
  const linkStubs = createLinkStubs(
    {
      register: (target) => {
        if (target) framework.discoveredTargets.pathnames.add(target.pathname);
        else framework.discoveredTargets.hasDynamicPathname = true;
      },
    },
    pathname,
  );
  const routerHookValue = createRouterHookValues(
    location,
    observed?.search ?? routeLocation.search,
    observed,
    linkStubs.fetcherForm,
  );
  // `RouterProvider$1` from `react-router/dom` wraps the core `RouterProvider`;
  // only the latter is kept as a fiber so SPA and framework trees line up.
  // Route discovery's manifest patch lands as a router state update here, which
  // reaches `<Scripts>` through `DataRouterStateContext`; `isRerenderedByBrowser`
  // is whatever else the browser entry re-renders the router for after hydration.
  const routerProviderShell = (isRerenderedByBrowser: UncertainFlag): StubComponent => ({
    displayName: "RouterProvider",
    render: (props, tools) => {
      const routerState = tools.hooks?.useState(objectValue());
      tools.hooks?.useEffect(() => {
        const discovered = discoversNewRoutes(framework, pathname);
        framework.isRerenderedAfterHydration = eitherFlag(isRerenderedByBrowser, discovered);
        if (discovered.value !== false) routerState?.[1](objectValue());
      }, []);
      return provide(
        DATA_ROUTER_STATE_CONTEXT,
        routerState?.[0] ?? objectValue(),
        withinRouter(getObjectProperty(props, "children"), location),
      );
    },
  });
  const frameworkRouter = (shell: StubComponent, displayName: string): StaticValue =>
    framework.routeTree
      ? element({ kind: "stub", stub: shell }, objectFromRecord({ children: framework.routeTree }))
      : unknownValue(`react-router: ${displayName} mounts routes only known to framework mode`);
  const hydratedRouterShell = routerProviderShell(clearsCriticalCss);
  const hydratedRouterStub: StubComponent = {
    displayName: "HydratedRouter",
    render: (_props, tools) => {
      const criticalCss = tools.hooks?.useState(
        hasCriticalCss === false
          ? UNDEFINED_VALUE
          : unknownPrimitiveValue("string", "critical CSS inlined by the dev server"),
      );
      tools.hooks?.useEffect(() => criticalCss?.[1](UNDEFINED_VALUE), []);
      if (!framework.routeTree) return frameworkRouter(hydratedRouterShell, "HydratedRouter");
      return fragmentOf([
        provide(
          FRAMEWORK_CONTEXT,
          objectFromRecord({ criticalCss: criticalCss?.[0] ?? UNDEFINED_VALUE }),
          frameworkRouter(hydratedRouterShell, "HydratedRouter"),
        ),
        element({ kind: "fragment" }, objectValue()),
      ]);
    },
  };
  // `RemixBrowser` keeps the critical CSS it hydrated with (only HMR clears it),
  // so route discovery is the only router update after hydration.
  const remixBrowserShell = routerProviderShell(NO_RERENDER);
  const remixBrowserStub: StubComponent = {
    displayName: "RemixBrowser",
    render: () =>
      fragmentOf([
        provide(
          REMIX_CONTEXT,
          unknownValue("remix: manifest and route modules are only known to the bundler"),
          frameworkRouter(remixBrowserShell, "RemixBrowser"),
        ),
        framework.config
          ? whenFlag(
              framework.config.isSingleFetch,
              element({ kind: "fragment" }, objectValue()),
              "remix `future.v3_singleFetch` is not static",
            )
          : NULL_VALUE,
      ]),
  };
  const metaStub: StubComponent = {
    displayName: "Meta",
    render: () => (framework.meta ? renderMetaDescriptors(framework.meta) : NULL_VALUE),
  };
  const linksStub: StubComponent = {
    displayName: "Links",
    render: () => (framework.links ? renderLinkDescriptors(framework.links) : NULL_VALUE),
  };
  // Remix's `<Links>` keeps the critical CSS the Vite dev server inlined and
  // wraps each descriptor in a keyed fragment.
  const remixLinksStub: StubComponent = {
    displayName: "Links",
    render: () =>
      framework.links
        ? renderRemixLinkDescriptors(framework.links, framework.hasInlinedCriticalCss)
        : NULL_VALUE,
  };
  // The classic compiler's dev server pushes reloads over a socket; the Vite
  // plugin's `LiveReload` is a no-op.
  const liveReloadStub: StubComponent = {
    displayName: "LiveReload",
    render: (props) =>
      framework.isClassicCompiler
        ? hostElement("script", {
            nonce: getObjectProperty(props, "nonce"),
            suppressHydrationWarning: primitiveValue(true),
            dangerouslySetInnerHTML: objectFromRecord({
              __html: unknownPrimitiveValue("string", "live reload client"),
            }),
          })
        : NULL_VALUE,
  };
  // Server-rendered framework apps inline a scroll-restoring `<script>`; SPA
  // mode (and plain data routers) render nothing.
  const scrollRestorationStub: StubComponent = {
    displayName: "ScrollRestoration",
    render: (props) => {
      if (!framework.config) return NULL_VALUE;
      return whenFlag(
        framework.config.isSsr,
        inlineScript(
          omitProps(props, SCROLL_RESTORATION_PROPS),
          "inline scroll restoration script",
        ),
        "react-router.config `ssr` is not static",
      );
    },
  };
  // `<Scripts>` renders the module preloads and boot scripts until its
  // hydration effect runs; the fibers stay until something above re-renders it.
  const scriptsStub = (
    context: ContextDefinition,
    bootstrap: (props: StaticObjectValue, config: FrameworkConfig) => StaticValue[],
  ): StubComponent => ({
    displayName: "Scripts",
    render: (props, tools) => {
      tools.readContext(context);
      tools.readContext(DATA_ROUTER_STATE_CONTEXT);
      const isHydrated = tools.hooks?.useRef(false);
      tools.hooks?.useEffect(() => {
        if (isHydrated) isHydrated.current = true;
      }, []);
      const { config } = framework;
      if (!config) return NULL_VALUE;
      const firstRender = listValue(bootstrap(props, config));
      if (!isHydrated?.current) return firstRender;
      const { value, reason } = framework.isRerenderedAfterHydration;
      return value === null ? branchValue([firstRender, NULL_VALUE], reason, null) : NULL_VALUE;
    },
  });
  const preloadUrl = (asset: string) =>
    unknownPrimitiveValue("string", `${asset} URL is assigned at build time`);
  const modulePreload = (
    props: StaticObjectValue,
    href: StaticValue,
    key: StaticValue | null = null,
  ) =>
    element(
      { kind: "host", tagName: "link" },
      objectFromRecord({
        rel: primitiveValue("modulepreload"),
        href,
        crossOrigin: getObjectProperty(props, "crossOrigin"),
        nonce: getObjectProperty(props, "nonce"),
        suppressHydrationWarning: primitiveValue(true),
      }),
      key,
    );
  const manifestPreload = (props: StaticObjectValue, config: FrameworkConfig, reason: string) =>
    whenFlag(
      config.isFogOfWar === null ? null : !config.isFogOfWar,
      modulePreload(props, preloadUrl("route manifest")),
      reason,
    );
  const bootScripts = (props: StaticObjectValue) =>
    fragmentOf([
      inlineScript(props, "server handoff context"),
      inlineScript(props, "route module imports", {
        type: primitiveValue("module"),
        async: primitiveValue(true),
      }),
    ]);
  const reactRouterScriptsStub = scriptsStub(FRAMEWORK_CONTEXT, (props, config) => [
    whenFlag(
      config.hasSubResourceIntegrity === false ? false : null,
      inlineScript(props, "subresource integrity import map", {
        "rr-importmap": primitiveValue(""),
        type: primitiveValue("importmap"),
      }),
      "the subresource integrity manifest is only inlined by production builds",
    ),
    manifestPreload(props, config, "react-router.config `routeDiscovery` is not static"),
    modulePreload(props, preloadUrl("client entry")),
    listValue(
      framework.routeModuleUrls.map((url) => {
        const href = primitiveValue(url);
        return modulePreload(props, href, href);
      }),
    ),
    bootScripts(props),
  ]);
  // Remix preloads the matched route modules from its build manifest (the
  // classic compiler's URLs are hashed at build time) and ends with the
  // deferred-data scripts, none on a page without streamed loaders.
  const remixScriptsStub = scriptsStub(REMIX_CONTEXT, (props, config) => [
    manifestPreload(props, config, "remix `future.v3_lazyRouteDiscovery` is not static"),
    modulePreload(props, preloadUrl("client entry")),
    listValue(
      framework.isClassicCompiler
        ? [
            unknownValue("remix: entry imports come from the build manifest"),
            ...framework.routeModuleUrls.map(() =>
              modulePreload(props, preloadUrl("route module")),
            ),
          ]
        : framework.routeModuleUrls.map((url) => {
            const href = primitiveValue(url);
            return modulePreload(props, href, href);
          }),
    ),
    bootScripts(props),
    listValue([]),
  ]);
  const routerProviderStub: StubComponent = {
    displayName: "RouterProvider",
    render: (props, tools) => {
      const router = getObjectProperty(props, "router");
      if (router.kind !== "object") {
        return unknownValue("react-router: router object was not created statically");
      }
      const resolveLazy: LazyResolver = (lazy) => tools.callAwaited(lazy, []);
      return withinRouter(
        renderMatchedRoutes(
          readRouteList(getObjectProperty(router, "routes"), resolveLazy),
          pathname,
          ROOT_PARENT_MATCH,
          withRenderedRoute,
        ),
        location,
      );
    },
  };
  const routerStub = (displayName: string): StubComponent => ({
    displayName,
    render: (props) => withinRouter(getObjectProperty(props, "children"), location),
  });
  const routesStub: StubComponent = {
    displayName: "Routes",
    render: (props, tools) => {
      const parent = readParentMatch(tools);
      if (!parent) {
        return unknownValue("react-router: the enclosing route's match is not static");
      }
      return renderMatchedRoutes(
        readRouteElements(getObjectProperty(props, "children"), (lazy) =>
          tools.callAwaited(lazy, []),
        ),
        pathname,
        parent,
        withRenderedRoute,
      );
    },
  };

  const remixLinkStubs = {
    link: remixLinkStub(linkStubs.link),
    navLink: remixLinkStub(linkStubs.navLink),
    form: remixFormStub(linkStubs.form),
  };
  const routerValue = (specifier: string, importedName: string): StaticValue | null => {
    const isRemix = specifier === REMIX_REACT_PACKAGE;
    switch (importedName) {
      case "createBrowserRouter":
      case "createHashRouter":
      case "createMemoryRouter":
      case "createStaticRouter":
        return createRouterFactory(importedName);
      case "createRoutesFromElements":
      case "createRoutesFromChildren":
        return nativeFunction(importedName, (args) =>
          routeObjectsFromElements(args[0] ?? UNDEFINED_VALUE),
        );
      case "RouterProvider":
        return stubValue(routerProviderStub);
      case "Routes":
        return stubValue(routesStub);
      case "useRoutes":
        return nativeFunction(importedName, (args, tools) => {
          const parent = readParentMatch(tools);
          if (!parent) {
            return unknownValue("react-router: the enclosing route's match is not static");
          }
          return renderMatchedRoutes(
            readRouteList(args[0] ?? listValue([]), (lazy) => tools.callAwaited(lazy, [])),
            pathname,
            parent,
            withRenderedRoute,
          );
        });
      case "Route":
        return stubValue(ROUTE_STUB);
      case "Outlet":
        return stubValue(OUTLET_STUB);
      case "Link":
        return stubValue(isRemix ? remixLinkStubs.link : linkStubs.link);
      case "NavLink":
        return stubValue(isRemix ? remixLinkStubs.navLink : linkStubs.navLink);
      case "Form":
        return stubValue(isRemix ? remixLinkStubs.form : linkStubs.form);
      case "Await":
        return stubValue(AWAIT_STUB);
      case "BrowserRouter":
      case "HashRouter":
      case "MemoryRouter":
      case "Router":
      case "unstable_HistoryRouter":
        return stubValue(routerStub(importedName));
      case "HydratedRouter":
        return stubValue(hydratedRouterStub);
      case "RemixBrowser":
        return stubValue(remixBrowserStub);
      case "Meta":
        return stubValue(metaStub);
      case "Links":
        return stubValue(isRemix ? remixLinksStub : linksStub);
      case "ScrollRestoration":
        return stubValue(scrollRestorationStub);
      case "Scripts":
        return stubValue(isRemix ? remixScriptsStub : reactRouterScriptsStub);
      case "LiveReload":
        return stubValue(liveReloadStub);
      case "PrefetchPageLinks":
        return stubValue(PREFETCH_PAGE_LINKS_STUB);
      case "Navigate":
        return stubValue(emptyStub(importedName));
      default:
        return routerHookValue(importedName);
    }
  };

  return {
    pathname,
    observed,
    framework,
    hydratedRouter: hydratedRouterStub,
    remixBrowser: remixBrowserStub,
    externalValues: (specifier, importedName) => {
      if (ROUTER_PACKAGES.has(specifier)) return routerValue(specifier, importedName);
      if (specifier === ROUTE_CONFIG_PACKAGE) return routeConfigValue(importedName);
      if (specifier === VITE_PACKAGE && importedName === "defineConfig") {
        return nativeFunction(importedName, (args) => args[0] ?? UNDEFINED_VALUE);
      }
      if (specifier === REMIX_DEV_PACKAGE && importedName === "vitePlugin") {
        return nativeFunction(importedName, (args) =>
          objectValue([
            { kind: "property", key: "name", value: primitiveValue(REMIX_VITE_PLUGIN_NAME) },
            { kind: "spread", value: args[0] ?? objectValue() },
          ]),
        );
      }
      return null;
    },
  };
};

/**
 * Framework mode (`@react-router/dev`): `app/routes.ts` lists route modules by
 * file; `app/root.tsx` is the implicit root route whose optional `Layout` export
 * wraps everything. Each route module's default export is its component.
 */
/**
 * The options object passed to `vitePlugin()` from `@remix-run/dev` in the
 * Vite config, whose default export may be a `defineConfig` callback.
 */
const readRemixPluginConfig = (
  interpreter: Interpreter,
  viteConfigModule: ModuleRecord,
): StaticValue => {
  const exported = interpreter.evaluateModuleExport(viteConfigModule, "default");
  const viteConfig =
    exported.kind === "function"
      ? interpreter.callValue(
          exported,
          [
            objectFromRecord({
              command: primitiveValue("serve"),
              mode: primitiveValue("development"),
            }),
          ],
          interpreter.createModuleContext(viteConfigModule),
          null,
        )
      : exported;
  if (viteConfig.kind !== "object") return viteConfig;
  const plugins = getObjectProperty(viteConfig, "plugins");
  if (plugins.kind !== "list") return plugins;
  const isRemixPlugin = (plugin: StaticValue): boolean =>
    plugin.kind === "object" &&
    readString(getObjectProperty(plugin, "name")) === REMIX_VITE_PLUGIN_NAME;
  return (
    plugins.items
      .flatMap((plugin) => (plugin.kind === "list" ? plugin.items : [plugin]))
      .find(isRemixPlugin) ?? objectValue()
  );
};

const readFutureFlag = (config: StaticObjectValue, flag: string): boolean | null => {
  const future = getObjectProperty(config, "future");
  if (!isDefined(future)) return false;
  if (future.kind !== "object") return null;
  const value = getObjectProperty(future, flag);
  return isDefined(value) ? getTruthiness(value) : false;
};

const bothFlags = (left: boolean | null, right: boolean | null): boolean | null =>
  left === false || right === false ? false : left === true && right === true ? true : null;

/**
 * `react-router.config.*`, `remix.config.*` or the Remix Vite plugin options.
 * The `@react-router/dev` defaults: SSR on, lazy route discovery under SSR, no
 * SRI. Remix only discovers routes lazily under `future.v3_lazyRouteDiscovery`
 * (and never in SPA mode) and has no SRI.
 */
const readFrameworkConfig = (
  interpreter: Interpreter,
  configModule: ModuleRecord | null,
  viteConfigModule: ModuleRecord | null,
  isRemix: boolean,
): FrameworkConfig => {
  const config = configModule
    ? interpreter.evaluateModuleExport(configModule, "default")
    : isRemix && viteConfigModule
      ? readRemixPluginConfig(interpreter, viteConfigModule)
      : objectValue();
  if (config.kind !== "object") {
    return { isSsr: null, isFogOfWar: null, hasSubResourceIntegrity: null, isSingleFetch: null };
  }
  const ssr = getObjectProperty(config, "ssr");
  const isSsr = isDefined(ssr) ? getTruthiness(ssr) : true;
  if (isRemix) {
    return {
      isSsr,
      isFogOfWar: bothFlags(isSsr, readFutureFlag(config, "v3_lazyRouteDiscovery")),
      hasSubResourceIntegrity: false,
      isSingleFetch: readFutureFlag(config, "v3_singleFetch"),
    };
  }
  const routeDiscovery = getObjectProperty(config, "routeDiscovery");
  const mode =
    routeDiscovery.kind === "object" ? readString(getObjectProperty(routeDiscovery, "mode")) : null;
  return {
    isSsr,
    isFogOfWar:
      mode === "initial" ? false : !isDefined(routeDiscovery) || mode === "lazy" ? isSsr : null,
    hasSubResourceIntegrity: readFutureFlag(config, "unstable_subResourceIntegrity"),
    isSingleFetch: false,
  };
};

const isClassicRemixCompiler = (configModule: ModuleRecord | null): boolean =>
  configModule !== null && path.basename(configModule.filePath).startsWith(REMIX_CONFIG_PREFIX);

const importsRemix = (module: ModuleRecord): boolean =>
  module.imports.some((binding) => binding.specifier === REMIX_REACT_PACKAGE);

const whenFlag = (flag: boolean | null, value: StaticValue, reason: string): StaticValue => {
  if (flag === null) return branchValue([value, NULL_VALUE], reason, null);
  return flag ? value : NULL_VALUE;
};

const inlineScript = (
  scriptProps: StaticValue,
  content: string,
  attributes: Record<string, StaticValue> = {},
): StaticValue =>
  element(
    { kind: "host", tagName: "script" },
    objectValue([
      { kind: "spread", value: scriptProps },
      { kind: "property", key: "suppressHydrationWarning", value: primitiveValue(true) },
      {
        kind: "property",
        key: "dangerouslySetInnerHTML",
        value: objectFromRecord({ __html: unknownPrimitiveValue("string", content) }),
      },
      ...Object.entries(attributes).map(([key, value]): StaticObjectEntry => ({
        kind: "property",
        key,
        value,
      })),
    ]),
  );

const renderFrameworkRoutes = (
  renderer: StaticRenderer,
  model: ReactRouterModel,
  appDirectory: string,
  routesSource: string,
  routes: RouteRecord[],
): Promise<StaticRenderResult> => {
  const findModule = (names: string[]): ModuleRecord | null => {
    for (const name of names) {
      const module = renderer.loadModule(path.join(appDirectory, name));
      if (module) return module;
    }
    return null;
  };
  const rootModule = findModule(ROOT_MODULE_NAMES);
  const clientEntry = findModule(CLIENT_ENTRY_NAMES);
  const projectDirectory = path.join(appDirectory, "..");
  const findProjectModule = (names: string[]): ModuleRecord | null =>
    names
      .map((name) => renderer.loadModule(path.join(projectDirectory, name)))
      .find((module) => module !== null) ?? null;
  const configModule = findProjectModule(CONFIG_MODULE_NAMES);
  const viteConfigModule = findProjectModule(VITE_CONFIG_MODULE_NAMES);
  const moduleUrl = (filePath: string): string =>
    `/${path.relative(renderer.options.rootDirectory, filePath).split(path.sep).join("/")}`;

  return renderer.renderWith((interpreter) => {
    const chain = bestMatch(routes, model.pathname, ROOT_PARENT_MATCH);
    if (!chain) {
      interpreter.report(
        "react-router-no-match",
        `no route in ${routesSource} matches ${model.pathname}`,
        null,
        "error",
      );
      return unknownValue(`react-router: no route matches ${model.pathname}`);
    }
    const { observed } = model;
    const loaderDataFor = (routeId: string): StaticValue =>
      observed?.loaderData(routeId) ?? unknownValue("loader data is only known at request time");
    const matchesValue = (): StaticValue =>
      observed?.matches ?? unknownValue("route matches are only known at request time");
    const routeProps = (params: RouteParams, routeId: string | null): StaticObjectValue =>
      objectFromRecord({
        loaderData: routeId === null ? unknownValue("route without an id") : loaderDataFor(routeId),
        params: paramsValue(params),
        matches: matchesValue(),
      });
    const leafParams = chain[chain.length - 1].params;
    const routeModules = new Map<RouteRecord, ModuleRecord>();
    const loadRouteModule = (route: RouteRecord): ModuleRecord | null => {
      if (!route.file || MDX_ROUTE_MODULE.test(route.file)) return null;
      const cached = routeModules.get(route);
      if (cached) return cached;
      const module = renderer.loadModule(path.join(appDirectory, route.file));
      if (module) routeModules.set(route, module);
      else interpreter.report("react-router-parse", `could not parse ${route.file}`, null, "error");
      return module;
    };
    const renderRoute = (route: RouteRecord, outlet: StaticValue): StaticValue => {
      if (!route.file) return outlet;
      const module = loadRouteModule(route);
      if (!module) {
        return unknownValue(
          MDX_ROUTE_MODULE.test(route.file)
            ? `mdx route module ${route.file} is compiled by the framework`
            : `unparsable route module ${route.file}`,
        );
      }
      // Resource routes (loader/action only) render nothing of their own.
      if (!interpreter.graph.listExportNames(module).includes("default")) return outlet;
      const component = interpreter.evaluateModuleExport(module, "default");
      const params = chain.find((match) => match.route === route)?.params ?? leafParams;
      return element(
        toElementType(component, path.basename(route.file, path.extname(route.file))),
        routeProps(params, route.id),
      );
    };
    const matched = composeChain(chain, model.pathname, renderRoute);
    if (!rootModule) return matched;

    // `meta`/`links` see every match root-first, exactly as `<Meta>`/`<Links>` do.
    const matchedModules: MatchedRouteModule[] = [
      { module: rootModule, params: {}, routeId: ROOT_ROUTE_ID },
      ...chain.flatMap((match) => {
        const module = loadRouteModule(match.route);
        const routeId = match.route.id;
        return module && routeId !== null ? [{ module, params: match.params, routeId }] : [];
      }),
    ];
    const callExport = (
      module: ModuleRecord,
      name: string,
      args: StaticValue[],
    ): StaticValue | null => {
      if (!interpreter.graph.listExportNames(module).includes(name)) return null;
      const exported = interpreter.evaluateModuleExport(module, name);
      if (exported.kind === "list") return exported;
      return interpreter.callValue(exported, args, interpreter.createModuleContext(module), null);
    };
    let leafMeta: StaticValue | null = null;
    for (const { module, params, routeId } of matchedModules) {
      const metaArgs = objectFromRecord({
        loaderData: loaderDataFor(routeId),
        params: paramsValue(params),
        location:
          observed?.location ?? objectFromRecord({ pathname: primitiveValue(model.pathname) }),
        matches: matchesValue(),
        error: NULL_VALUE,
      });
      leafMeta = callExport(module, "meta", [metaArgs]) ?? leafMeta;
    }
    const isRemix = importsRemix(rootModule);
    model.framework.config = readFrameworkConfig(
      interpreter,
      configModule,
      viteConfigModule,
      isRemix,
    );
    model.framework.routes = routes;
    model.framework.routeModuleUrls = [
      ...new Set([
        moduleUrl(rootModule.filePath),
        ...chain.flatMap((match) =>
          match.route.file ? [moduleUrl(path.join(appDirectory, match.route.file))] : [],
        ),
      ]),
    ];
    model.framework.isClassicCompiler = isClassicRemixCompiler(configModule);
    model.framework.hasInlinedCriticalCss =
      !model.framework.isClassicCompiler &&
      importsCriticalCss(interpreter.graph, [
        ...(clientEntry ? [clientEntry] : []),
        ...matchedModules.map(({ module }) => module),
      ]);
    const compiledMatch = chain.find(
      (match) => match.route.file && loadRouteModule(match.route) === null,
    );
    if (compiledMatch?.route.file) {
      const compiledExports = unknownValue(
        `meta and links of ${compiledMatch.route.file} come from the framework's compiler`,
      );
      model.framework.meta = compiledExports;
      model.framework.links = compiledExports;
    } else {
      model.framework.meta = leafMeta ?? listValue([]);
      model.framework.links = dedupeLinkDescriptors(
        matchedModules.flatMap(({ module }) => callExport(module, "links", []) ?? []),
      );
    }

    const rootComponent = interpreter.evaluateModuleExport(rootModule, "default");
    const app = element(toElementType(rootComponent, "App"), routeProps({}, ROOT_ROUTE_ID));
    const rootElement = interpreter.graph.listExportNames(rootModule).includes("Layout")
      ? element(
          toElementType(interpreter.evaluateModuleExport(rootModule, "Layout"), "Layout"),
          objectFromRecord({ children: app }),
        )
      : app;
    model.framework.routeTree = renderedRoute(matched, {}, ROOT_ROUTE_ID, "/", rootElement);

    // The client entry decides what wraps `<HydratedRouter />` (StrictMode, providers);
    // without one, `@react-router/dev` uses `<StrictMode><HydratedRouter /></StrictMode>`
    // and `@remix-run/dev` `<StrictMode><RemixBrowser /></StrictMode>`.
    if (clientEntry) {
      const entry = renderer.evaluateEntryElement(interpreter, clientEntry);
      if (entry) return entry;
    }
    const browserRouter = isRemix ? model.remixBrowser : model.hydratedRouter;
    return element(
      { kind: "strict-mode" },
      objectFromRecord({ children: element({ kind: "stub", stub: browserRouter }, objectValue()) }),
    );
  });
};

export const renderReactRouterRoute = async (
  renderer: StaticRenderer,
  model: ReactRouterModel,
  options: ReactRouterRouteOptions,
): Promise<StaticRenderResult> => {
  const appDirectory = renderer.resolvePath(options.appDirectory ?? "app");
  const routesModule = options.routesModule ?? findRouteFile(appDirectory, "routes");
  if (routesModule === null) {
    const routesDirectory = path.join(appDirectory, "routes");
    if (existsSync(routesDirectory)) {
      return renderFrameworkRoutes(
        renderer,
        model,
        appDirectory,
        routesDirectory,
        readFsRoutes(appDirectory),
      );
    }
    return renderer.renderWith((interpreter) => {
      interpreter.report(
        "react-router-missing-entry",
        `react-router entries need static.entry (an entry module or routes.ts) or a routes directory under ${appDirectory}`,
        null,
        "error",
      );
      return unknownValue("react-router entry not configured");
    });
  }
  const modulePath = renderer.resolvePath(routesModule);
  const module = renderer.loadModule(modulePath);
  if (!module) {
    return renderer.renderWith((interpreter) => {
      interpreter.report("react-router-parse", `could not parse ${modulePath}`, null, "error");
      return unknownValue("unparsable react-router entry");
    });
  }
  if (findRootRenderCalls(module).length > 0) return renderer.renderEntry(modulePath);

  let probedRoutes: RouteRecord[] | null = null;
  const probe = await renderer.renderWith((interpreter) => {
    const config = interpreter.evaluateModuleExport(module, "default");
    if (config.kind === "list") probedRoutes = readRouteList(config, null);
    else if (
      config.kind === "external" &&
      config.packageName === AUTO_ROUTES_PACKAGE &&
      config.importedName === "autoRoutes()"
    ) {
      probedRoutes = readAutoRoutes(path.dirname(modulePath));
    } else if (
      config.kind === "external" &&
      config.packageName === ROUTES_OPTION_ADAPTER_PACKAGE &&
      config.importedName === "remixRoutesOptionAdapter()" &&
      module.imports.some((binding) => binding.specifier === FLAT_ROUTES_PACKAGE)
    ) {
      probedRoutes = readFlatRoutes(path.dirname(modulePath));
    } else if (
      config.kind === "external" &&
      config.packageName === FS_ROUTES_PACKAGE &&
      config.importedName === "flatRoutes()"
    ) {
      probedRoutes = readFsRoutes(path.dirname(modulePath));
    }
    return NULL_VALUE;
  });
  if (probedRoutes === null) {
    return renderer.renderWith((interpreter) => {
      interpreter.report(
        "react-router-unrecognized-entry",
        `${modulePath} has neither a root render call nor a default-exported route list`,
        null,
        "error",
      );
      for (const diagnostic of probe.diagnostics) {
        interpreter.report(
          diagnostic.code,
          diagnostic.message,
          diagnostic.location,
          diagnostic.severity,
        );
      }
      return unknownValue("unrecognized react-router entry");
    });
  }
  return renderFrameworkRoutes(renderer, model, path.dirname(modulePath), modulePath, probedRoutes);
};
