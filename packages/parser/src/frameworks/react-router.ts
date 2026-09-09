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
import { AUTO_ROUTES_PACKAGE, readAutoRoutes } from "./react-router-auto-routes.js";
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
} from "./react-router-document.js";
import type { Interpreter } from "../evaluate/interpreter.js";
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
import { routeIdFromFile, splitPathname } from "./route-files.js";
import { element, emptyStub, nativeFunction, omitProps, stubValue } from "./stubs.js";

const SCROLL_RESTORATION_PROPS: ReadonlySet<string> = new Set(["getKey", "storageKey"]);

export interface ReactRouterRouteOptions {
  /**
   * Module that boots the router. Either an entry with a root render call
   * (`<RouterProvider router={router} />` or `<BrowserRouter><Routes>…`) or a
   * framework-mode `app/routes.ts` whose default export lists the routes.
   */
  routesModule?: string;
}

/**
 * Everything the static side needs to stand in for React Router for one URL:
 * an `ExternalValueProvider` that models the router's exports, and the route
 * renderer for framework-mode projects.
 */
export interface ReactRouterModel {
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
];

const ROUTER_PACKAGES = new Set([
  "react-router",
  "react-router/dom",
  "react-router-dom",
  "@remix-run/react",
]);
const ROUTE_CONFIG_PACKAGE = "@react-router/dev/routes";

/**
 * Mirrors React Router's `RouteContext` (displayName `Route`). The static
 * provider value is `{ outlet, params, id, pathnameBase }`: the element for the
 * matched child route, the params accumulated down to this match, the route id
 * that keys loader data, and the URL prefix descendant `<Routes>` match after.
 */
export const ROUTE_CONTEXT: ContextDefinition = {
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
      return element(
        { kind: "host", tagName: "a" },
        objectFromRecord({
          href: isAbsolute
            ? primitiveValue(absoluteHref)
            : resolved
              ? primitiveValue(resolved.href)
              : unknownPrimitiveValue("string", "href is resolved by the router"),
          children: getObjectProperty(props, "children"),
        }),
      );
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
  "useFetchers",
  "useRouteError",
  "useHref",
  "useResolvedPath",
  "useBlocker",
  "useBeforeUnload",
  "useSubmit",
  "useFormAction",
  "useAsyncValue",
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
    case "useRouteLoaderData":
      return nativeFunction(importedName, (args) => {
        const routeId = args[0] ? readString(args[0]) : null;
        return routeId === null
          ? unknownValue("react-router useRouteLoaderData() with a dynamic route id")
          : observed.loaderData(routeId);
      });
    case "useMatches":
      return nativeFunction(importedName, () => observed.matches);
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
  const framework: FrameworkState = {
    routeTree: null,
    routes: null,
    meta: null,
    links: null,
    config: null,
    routeModuleUrls: [],
    discoveredTargets: { pathnames: new Set(), hasDynamicPathname: false },
    isRerenderedAfterHydration: { value: hasCriticalCss, reason: CRITICAL_CSS_REASON },
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
  // reaches `<Scripts>` through `DataRouterStateContext`.
  const routerProviderShell: StubComponent = {
    displayName: "RouterProvider",
    render: (props, tools) => {
      const routerState = tools.hooks?.useState(objectValue());
      tools.hooks?.useEffect(() => {
        const discovered = discoversNewRoutes(framework, pathname);
        framework.isRerenderedAfterHydration = eitherFlag(
          framework.isRerenderedAfterHydration,
          discovered,
        );
        if (discovered.value !== false) routerState?.[1](objectValue());
      }, []);
      return provide(
        DATA_ROUTER_STATE_CONTEXT,
        routerState?.[0] ?? objectValue(),
        withinRouter(getObjectProperty(props, "children"), location),
      );
    },
  };
  const hydratedRouterStub: StubComponent = {
    displayName: "HydratedRouter",
    render: (_props, tools) => {
      const criticalCss = tools.hooks?.useState(
        hasCriticalCss === false
          ? UNDEFINED_VALUE
          : unknownPrimitiveValue("string", "critical CSS inlined by the dev server"),
      );
      tools.hooks?.useEffect(() => criticalCss?.[1](UNDEFINED_VALUE), []);
      if (!framework.routeTree) {
        return unknownValue(
          "react-router: HydratedRouter mounts routes only known to framework mode",
        );
      }
      return element(
        { kind: "fragment" },
        objectFromRecord({
          children: listValue([
            provide(
              FRAMEWORK_CONTEXT,
              objectFromRecord({ criticalCss: criticalCss?.[0] ?? UNDEFINED_VALUE }),
              element(
                { kind: "stub", stub: routerProviderShell },
                objectFromRecord({ children: framework.routeTree }),
              ),
            ),
            element({ kind: "fragment" }, objectValue()),
          ]),
        }),
      );
    },
  };
  const metaStub: StubComponent = {
    displayName: "Meta",
    render: () => (framework.meta ? renderMetaDescriptors(framework.meta) : NULL_VALUE),
  };
  const linksStub: StubComponent = {
    displayName: "Links",
    render: () => (framework.links ? renderLinkDescriptors(framework.links) : NULL_VALUE),
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
  const scriptsStub: StubComponent = {
    displayName: "Scripts",
    render: (props, tools) => {
      tools.readContext(FRAMEWORK_CONTEXT);
      tools.readContext(DATA_ROUTER_STATE_CONTEXT);
      const isHydrated = tools.hooks?.useRef(false);
      tools.hooks?.useEffect(() => {
        if (isHydrated) isHydrated.current = true;
      }, []);
      const { config } = framework;
      if (!config) return NULL_VALUE;
      const preloadUrl = (asset: string) =>
        unknownPrimitiveValue("string", `${asset} URL is assigned at build time`);
      const modulePreload = (href: StaticValue, key: StaticValue | null = null) =>
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
      const firstRender = listValue([
        whenFlag(
          config.hasSubResourceIntegrity === false ? false : null,
          inlineScript(props, "subresource integrity import map", {
            "rr-importmap": primitiveValue(""),
            type: primitiveValue("importmap"),
          }),
          "the subresource integrity manifest is only inlined by production builds",
        ),
        whenFlag(
          config.isFogOfWar === null ? null : !config.isFogOfWar,
          modulePreload(preloadUrl("route manifest")),
          "react-router.config `routeDiscovery` is not static",
        ),
        modulePreload(preloadUrl("client entry")),
        listValue(
          framework.routeModuleUrls.map((url) => {
            const href = primitiveValue(url);
            return modulePreload(href, href);
          }),
        ),
        element(
          { kind: "fragment" },
          objectFromRecord({
            children: listValue([
              inlineScript(props, "server handoff context"),
              inlineScript(props, "route module imports", {
                type: primitiveValue("module"),
                async: primitiveValue(true),
              }),
            ]),
          }),
        ),
      ]);
      if (!isHydrated?.current) return firstRender;
      const { value, reason } = framework.isRerenderedAfterHydration;
      return value === null ? branchValue([firstRender, NULL_VALUE], reason, null) : NULL_VALUE;
    },
  };
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

  const routerValue = (importedName: string): StaticValue | null => {
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
        return stubValue(linkStubs.link);
      case "NavLink":
        return stubValue(linkStubs.navLink);
      case "Form":
        return stubValue(linkStubs.form);
      case "BrowserRouter":
      case "HashRouter":
      case "MemoryRouter":
      case "Router":
      case "unstable_HistoryRouter":
        return stubValue(routerStub(importedName));
      case "HydratedRouter":
        return stubValue(hydratedRouterStub);
      case "Meta":
        return stubValue(metaStub);
      case "Links":
        return stubValue(linksStub);
      case "ScrollRestoration":
        return stubValue(scrollRestorationStub);
      case "Scripts":
        return stubValue(scriptsStub);
      case "Navigate":
      case "PrefetchPageLinks":
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
    externalValues: (specifier, importedName) => {
      if (ROUTER_PACKAGES.has(specifier)) return routerValue(importedName);
      if (specifier === ROUTE_CONFIG_PACKAGE) return routeConfigValue(importedName);
      return null;
    },
  };
};

/**
 * Framework mode (`@react-router/dev`): `app/routes.ts` lists route modules by
 * file; `app/root.tsx` is the implicit root route whose optional `Layout` export
 * wraps everything. Each route module's default export is its component.
 */
/** The `@react-router/dev` defaults: SSR on, lazy route discovery under SSR, no SRI. */
const readFrameworkConfig = (
  interpreter: Interpreter,
  configModule: ModuleRecord | null,
): FrameworkConfig => {
  const config = configModule
    ? interpreter.evaluateModuleExport(configModule, "default")
    : objectValue();
  if (config.kind !== "object") {
    return { isSsr: null, isFogOfWar: null, hasSubResourceIntegrity: null };
  }
  const ssr = getObjectProperty(config, "ssr");
  const isSsr = isDefined(ssr) ? getTruthiness(ssr) : true;
  const routeDiscovery = getObjectProperty(config, "routeDiscovery");
  const mode =
    routeDiscovery.kind === "object" ? readString(getObjectProperty(routeDiscovery, "mode")) : null;
  const future = getObjectProperty(config, "future");
  const subResourceIntegrity =
    future.kind === "object"
      ? getObjectProperty(future, "unstable_subResourceIntegrity")
      : UNDEFINED_VALUE;
  return {
    isSsr,
    isFogOfWar:
      mode === "initial" ? false : !isDefined(routeDiscovery) || mode === "lazy" ? isSsr : null,
    hasSubResourceIntegrity: isDefined(subResourceIntegrity)
      ? getTruthiness(subResourceIntegrity)
      : false,
  };
};

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
  routesModulePath: string,
  routes: RouteRecord[],
): Promise<StaticRenderResult> => {
  const appDirectory = path.dirname(routesModulePath);
  const findModule = (names: string[]): ModuleRecord | null => {
    for (const name of names) {
      const module = renderer.loadModule(path.join(appDirectory, name));
      if (module) return module;
    }
    return null;
  };
  const rootModule = findModule(ROOT_MODULE_NAMES);
  const clientEntry = findModule(CLIENT_ENTRY_NAMES);
  const configModule = CONFIG_MODULE_NAMES.map((name) =>
    renderer.loadModule(path.join(appDirectory, "..", name)),
  ).find((module) => module !== null);

  return renderer.renderWith((interpreter) => {
    const chain = bestMatch(routes, model.pathname, ROOT_PARENT_MATCH);
    if (!chain) {
      interpreter.report(
        "react-router-no-match",
        `no route in ${routesModulePath} matches ${model.pathname}`,
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
      if (!route.file) return null;
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
      if (!module) return unknownValue(`unparsable route module ${route.file}`);
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
    model.framework.config = readFrameworkConfig(interpreter, configModule ?? null);
    model.framework.routes = routes;
    model.framework.routeModuleUrls = [
      ...new Set(
        matchedModules.map(
          ({ module }) =>
            `/${path.relative(renderer.options.rootDirectory, module.filePath).split(path.sep).join("/")}`,
        ),
      ),
    ];
    model.framework.meta = leafMeta ?? listValue([]);
    model.framework.links = dedupeLinkDescriptors(
      matchedModules.flatMap(({ module }) => callExport(module, "links", []) ?? []),
    );

    const rootComponent = interpreter.evaluateModuleExport(rootModule, "default");
    const app = element(toElementType(rootComponent, "App"), routeProps({}, ROOT_ROUTE_ID));
    const layout = interpreter.evaluateModuleExport(rootModule, "Layout");
    const rootElement = isDefined(layout)
      ? element(toElementType(layout, "Layout"), objectFromRecord({ children: app }))
      : app;
    model.framework.routeTree = renderedRoute(matched, {}, ROOT_ROUTE_ID, "/", rootElement);

    // The client entry decides what wraps `<HydratedRouter />` (StrictMode, providers);
    // without one, `@react-router/dev` uses `<StrictMode><HydratedRouter /></StrictMode>`.
    if (clientEntry) {
      const entry = renderer.evaluateEntryElement(interpreter, clientEntry);
      if (entry) return entry;
    }
    return element(
      { kind: "strict-mode" },
      objectFromRecord({
        children: element({ kind: "stub", stub: model.hydratedRouter }, objectValue()),
      }),
    );
  });
};

export const renderReactRouterRoute = async (
  renderer: StaticRenderer,
  model: ReactRouterModel,
  options: ReactRouterRouteOptions,
): Promise<StaticRenderResult> => {
  if (!options.routesModule) {
    return renderer.renderWith((interpreter) => {
      interpreter.report(
        "react-router-missing-entry",
        "react-router entries need static.entry (an entry module or app/routes.ts)",
        null,
        "error",
      );
      return unknownValue("react-router entry not configured");
    });
  }
  const modulePath = renderer.resolvePath(options.routesModule);
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
  return renderFrameworkRoutes(renderer, model, modulePath, probedRoutes);
};
