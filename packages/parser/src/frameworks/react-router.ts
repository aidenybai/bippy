import { existsSync } from "node:fs";
import path from "node:path";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import { findRootRenderCalls } from "../render/find-root-elements.js";
import { FS_ROUTES_PACKAGE, readFsRoutes } from "./fs-routes.js";
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
  renderRemixLinkDescriptors,
} from "./react-router-document.js";
import type { Interpreter } from "../evaluate/interpreter.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type {
  CapturedRouterState,
  ContextDefinition,
  ExternalValueProvider,
  ModuleRecord,
  StaticElementValue,
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

export interface ReactRouterRouteOptions {
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
  /** `ssr` from the framework config; `false` is SPA mode. Null outside framework mode. */
  ssr: StaticValue | null;
  /** `future.v3_singleFetch` from the Remix config; `RemixBrowser` renders an extra fragment for it. */
  singleFetch: StaticValue | null;
  /** `future.v3_lazyRouteDiscovery`; when set, Remix's `<Scripts>` skips the manifest preload. */
  lazyRouteDiscovery: StaticValue | null;
  /** Route modules matched root-first, each preloaded by Remix's `<Scripts>`. */
  matchedRouteCount: number;
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
 * provider value is `{ outlet, params, id }`: the element for the matched child
 * route, the params accumulated down to this match, and the route id that keys
 * loader data.
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
  return {
    id: readRouteId(value, treePath),
    path: readString(getObjectProperty(value, "path")),
    index: getTruthiness(getObjectProperty(value, "index")) === true,
    element: content.element,
    component: content.component,
    file: readString(getObjectProperty(value, "file")),
    children: readRouteList(getObjectProperty(value, "children"), resolveLazy, treePath),
    uncertainty: hasSpread ? "route object has a spread" : content.uncertainty,
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

/** `<Route path element>` elements nested under `<Routes>` are routes too (`createRoutesFromChildren`). */
const readRouteElements = (
  value: StaticValue,
  resolveLazy: LazyResolver | null,
  parentPath: number[] = [],
): RouteRecord[] => {
  const elements = value.kind === "list" ? value.items : [value];
  const routes: RouteRecord[] = [];
  elements.forEach((item, index) => {
    const treePath = [...parentPath, index];
    if (item.kind === "element" && item.type.kind === "stub" && item.type.stub === ROUTE_STUB) {
      const props = item.props;
      const content = readRouteContent(props, getObjectProperty(props, "lazy"), resolveLazy);
      routes.push({
        id: readRouteId(props, treePath),
        path: readString(getObjectProperty(props, "path")),
        index: getTruthiness(getObjectProperty(props, "index")) === true,
        element: content.element,
        component: content.component,
        file: null,
        children: readRouteElements(getObjectProperty(props, "children"), resolveLazy, treePath),
        uncertainty: content.uncertainty,
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
}

/** Matches one route's own `path` against the remaining URL segments. */
const matchOwnPath = (routePath: string | null, remaining: string[]): OwnPathMatch | null => {
  if (routePath === null) return { rest: remaining, score: 0, params: {} };
  const params: RouteParams = {};
  let score = 0;
  let cursor = 0;
  for (const segment of splitPathname(routePath)) {
    if (segment === "*") {
      params["*"] = remaining.slice(cursor).join("/");
      return { rest: [], score: score + SPLAT_PENALTY, params };
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
  return { rest: remaining.slice(cursor), score, params };
};

const matchRoutes = (
  routes: RouteRecord[],
  remaining: string[],
  inherited: RouteParams,
): RankedMatch[] => {
  const matches: RankedMatch[] = [];
  for (const route of routes) {
    const own = matchOwnPath(route.path, remaining);
    if (!own) continue;
    const params = { ...inherited, ...own.params };
    const match: RouteMatch = { route, params };
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
    for (const child of matchRoutes(route.children, own.rest, params)) {
      matches.push({ chain: [match, ...child.chain], score: own.score + child.score });
    }
    if (own.rest.length === 0 && route.path !== null) {
      matches.push({ chain: [match], score: own.score });
    }
  }
  return matches;
};

const bestMatch = (routes: RouteRecord[], pathname: string): RouteMatch[] | null => {
  const matches = matchRoutes(routes, splitPathname(pathname), {});
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
const RENDERED_ROUTE_STUB: StubComponent = {
  displayName: "RenderedRoute",
  render: (props) =>
    element(
      { kind: "context-provider", context: ROUTE_CONTEXT, displayName: ROUTE_CONTEXT.displayName },
      objectFromRecord({
        value: getObjectProperty(props, "routeContext"),
        children: getObjectProperty(props, "children"),
      }),
    ),
};

const renderedRoute = (
  outlet: StaticValue,
  params: RouteParams,
  children: StaticValue,
  routeId: string | null,
): StaticElementValue =>
  element(
    { kind: "stub", stub: RENDERED_ROUTE_STUB },
    objectFromRecord({
      routeContext: objectFromRecord({
        outlet,
        params: paramsValue(params),
        id: routeId === null ? UNDEFINED_VALUE : primitiveValue(routeId),
      }),
      children,
    }),
  );

/**
 * Builds the element for a matched chain exactly like `_renderMatches`: each
 * match renders inside a `RenderedRoute`, innermost first, and a route without
 * an element renders its outlet directly.
 */
const composeChain = (
  chain: RouteMatch[],
  renderRoute: (route: RouteRecord, outlet: StaticValue) => StaticValue,
): StaticValue => {
  let outlet: StaticValue = NULL_VALUE;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const { route, params } = chain[index];
    if (route.uncertainty) {
      outlet = unknownValue(`react-router: ${route.uncertainty}`);
      continue;
    }
    outlet = renderedRoute(outlet, params, renderRoute(route, outlet), route.id);
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
 * object) may rank above any statically matched route, so a match found next
 * to them is only the preferred alternative.
 */
const renderMatchedRoutes = (routes: RouteRecord[], pathname: string): StaticValue => {
  const unreadable = routes.filter((route) => route.uncertainty !== null && route.path === null);
  const chain = bestMatch(routes, pathname);
  if (!chain) {
    return unknownValue(
      unreadable.length > 0
        ? "react-router: routes could not be read statically"
        : `react-router: no route matches ${pathname}`,
    );
  }
  const matched = composeChain(chain, renderDataRoute);
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

const ROUTE_STUB: StubComponent = {
  displayName: "Route",
  render: () => NULL_VALUE,
};

/** `<Outlet>` renders the parent match's outlet inside an `OutletContext` provider (`useOutlet`). */
const OUTLET_STUB: StubComponent = {
  displayName: "Outlet",
  render: (props, tools) =>
    element(
      { kind: "context-provider", context: OUTLET_CONTEXT, displayName: null },
      objectFromRecord({
        value: getObjectProperty(props, "context"),
        children: readRouteContext(tools, "outlet"),
      }),
    ),
};

interface LinkPrefetch {
  /** Null when only the browser decides (viewport visibility, non-static props). */
  isPrefetching: boolean | null;
  reason: string | null;
}

const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const PREFETCH_PROPS: ReadonlySet<string> = new Set(["prefetch", "discover"]);

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
  const isAbsolute = to.kind === "object" ? false : target === null ? null : ABSOLUTE_URL_PATTERN.test(target);
  if (isAbsolute === null) return { isPrefetching: null, reason: "`to` is not a static string" };
  if (isAbsolute) return { isPrefetching: false, reason: null };
  return mode === "render"
    ? { isPrefetching: true, reason: null }
    : { isPrefetching: null, reason: "viewport prefetch waits for the IntersectionObserver" };
};

const prefetchPageLinks = (): StaticValue =>
  element(
    { kind: "stub", stub: PREFETCH_PAGE_LINKS_STUB },
    objectFromRecord({ page: unknownValue("href is resolved by the router") }),
  );

const fragmentOf = (children: StaticValue[]): StaticElementValue =>
  element({ kind: "fragment" }, objectFromRecord({ children: listValue(children) }));

/** `shouldPrefetch ? <>{link}<PrefetchPageLinks /></> : link` */
const LINK_STUB: StubComponent = {
  displayName: "Link",
  tag: ForwardRefTag,
  render: (props) => {
    const anchor = element(
      { kind: "host", tagName: "a" },
      objectFromRecord({
        href: unknownValue("href is resolved by the router"),
        children: getObjectProperty(props, "children"),
      }),
    );
    const { isPrefetching, reason } = readLinkPrefetch(props);
    if (isPrefetching === false) return anchor;
    const prefetching = fragmentOf([anchor, prefetchPageLinks()]);
    return isPrefetching
      ? prefetching
      : branchValue([anchor, prefetching], `react-router: <Link> ${reason}`);
  },
};

/** `NavLink` renders a `Link` after computing its active state; `children` may be a render function. */
const NAV_LINK_STUB: StubComponent = {
  displayName: "NavLink",
  tag: ForwardRefTag,
  render: (props) => {
    const children = getObjectProperty(props, "children");
    return element(
      { kind: "stub", stub: LINK_STUB },
      objectValue([
        { kind: "spread", value: props },
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

const FORM_STUB: StubComponent = {
  displayName: "Form",
  tag: ForwardRefTag,
  render: (props) =>
    element(
      { kind: "host", tagName: "form" },
      objectFromRecord({ children: getObjectProperty(props, "children") }),
    ),
};

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
    const trailing =
      isPrefetching === null
        ? branchValue([NULL_VALUE, prefetchPageLinks()], `remix: <${inner.displayName}> ${reason}`)
        : isPrefetching
          ? prefetchPageLinks()
          : NULL_VALUE;
    return fragmentOf([innerElement, trailing]);
  },
});

const REMIX_LINK_STUB = remixLinkStub(LINK_STUB);
const REMIX_NAV_LINK_STUB = remixLinkStub(NAV_LINK_STUB);
const REMIX_FORM_STUB: StubComponent = {
  displayName: "Form",
  tag: ForwardRefTag,
  render: (props) => element({ kind: "stub", stub: FORM_STUB }, omitProps(props, PREFETCH_PROPS)),
};

const createRouterFactory = (name: string): StaticValue =>
  nativeFunction(name, (args) => objectFromRecord({ routes: args[0] ?? listValue([]) }));

/** Values only the running router knows; each is a hook returning an explicit unknown. */
const RUNTIME_ONLY_HOOKS = new Set([
  "useLoaderData",
  "useRouteLoaderData",
  "useActionData",
  "useMatches",
  "useMatch",
  "useNavigation",
  "useRevalidator",
  "useFetcher",
  "useFetchers",
  "useRouteError",
  "useSearchParams",
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
    case "useSearchParams":
      return nativeFunction(importedName, () =>
        listValue([
          observed.searchParams,
          nativeFunction("setSearchParams", () => UNDEFINED_VALUE),
        ]),
      );
    default:
      return null;
  }
};

const locationValue = (pathname: string, observed: ObservedRouterState | null): StaticValue =>
  observed?.location ??
  objectFromRecord({
    pathname: primitiveValue(pathname),
    search: primitiveValue(""),
    hash: primitiveValue(""),
    state: NULL_VALUE,
    key: unknownValue("location key is assigned at runtime"),
  });

const withinRouter = (
  children: StaticValue,
  pathname: string,
  observed: ObservedRouterState | null,
): StaticElementValue =>
  element(
    { kind: "context-provider", context: LOCATION_CONTEXT, displayName: "Location" },
    objectFromRecord({
      value: objectFromRecord({
        location: locationValue(pathname, observed),
        navigationType: primitiveValue("POP"),
      }),
      children,
    }),
  );

const routerHookValue = (
  importedName: string,
  pathname: string,
  observed: ObservedRouterState | null,
): StaticValue | null => {
  switch (importedName) {
    case "useParams":
      return nativeFunction(importedName, (_args, tools) => readRouteContext(tools, "params"));
    case "useOutlet":
      return nativeFunction(importedName, (_args, tools) => readRouteContext(tools, "outlet"));
    case "useOutletContext":
      return nativeFunction(importedName, (_args, tools) => tools.readContext(OUTLET_CONTEXT));
    case "useLocation":
      return nativeFunction(importedName, () => locationValue(pathname, observed));
    case "useNavigate":
      return nativeFunction(importedName, () => nativeFunction("navigate", () => UNDEFINED_VALUE));
    case "useNavigationType":
      return nativeFunction(importedName, () => primitiveValue("POP"));
    case "useInRouterContext":
      return nativeFunction(importedName, (_args, tools) =>
        primitiveValue(tools.readContext(LOCATION_CONTEXT).kind !== "primitive"),
      );
    default:
      if (!RUNTIME_ONLY_HOOKS.has(importedName)) return null;
      return (
        (observed && observedHookValue(importedName, observed)) ?? runtimeOnlyHook(importedName)
      );
  }
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

/** `RemixContext` (displayName `Remix`), provided by `RemixBrowser` around the router. */
const REMIX_CONTEXT: ContextDefinition = {
  name: "RemixContext",
  displayName: "Remix",
  defaultValue: UNDEFINED_VALUE,
  location: null,
};

export const createReactRouterModel = (
  pathname: string,
  routerState: CapturedRouterState | null = null,
): ReactRouterModel => {
  const framework: FrameworkState = {
    routeTree: null,
    meta: null,
    links: null,
    ssr: null,
    singleFetch: null,
    lazyRouteDiscovery: null,
    matchedRouteCount: 0,
  };
  const observed = observeRouterState(routerState, pathname);
  // `RouterProvider$1` from `react-router/dom` wraps the core `RouterProvider`;
  // only the latter is kept as a fiber so SPA and framework trees line up.
  const routerProviderShell: StubComponent = {
    displayName: "RouterProvider",
    render: (props) => withinRouter(getObjectProperty(props, "children"), pathname, observed),
  };
  const frameworkRouter = (displayName: string): StaticValue =>
    framework.routeTree
      ? element(
          { kind: "stub", stub: routerProviderShell },
          objectFromRecord({ children: framework.routeTree }),
        )
      : unknownValue(`react-router: ${displayName} mounts routes only known to framework mode`);
  const hydratedRouterStub: StubComponent = {
    displayName: "HydratedRouter",
    render: () =>
      fragmentOf([frameworkRouter("HydratedRouter"), element({ kind: "fragment" }, objectValue())]),
  };
  // `@remix-run/react`'s `RemixBrowser`: `RemixContext.Provider` > `RemixErrorBoundary`
  // > `RouterProvider`, then an empty fragment only under `future.v3_singleFetch`.
  const remixBrowserStub: StubComponent = {
    displayName: "RemixBrowser",
    render: () => {
      const singleFetch = framework.singleFetch ?? primitiveValue(false);
      const isSingleFetch = getTruthiness(singleFetch);
      const trailingFragment = element({ kind: "fragment" }, objectValue());
      return fragmentOf([
        element(
          {
            kind: "context-provider",
            context: REMIX_CONTEXT,
            displayName: REMIX_CONTEXT.displayName,
          },
          objectFromRecord({
            value: unknownValue("remix: manifest and route modules are only known to the bundler"),
            children: frameworkRouter("RemixBrowser"),
          }),
        ),
        isSingleFetch === true
          ? trailingFragment
          : isSingleFetch === false
            ? NULL_VALUE
            : branchValue(
                [trailingFragment, NULL_VALUE],
                "remix `future.v3_singleFetch` is not static",
                null,
              ),
      ]);
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
  const remixLinksStub: StubComponent = {
    displayName: "Links",
    render: () => (framework.links ? renderRemixLinkDescriptors(framework.links) : NULL_VALUE),
  };
  // `@remix-run/react`'s `<Scripts>` keeps its hydration-time output (module
  // preloads and the two inline scripts) until a router update re-renders it,
  // after which it returns null; only the runtime knows whether one happened.
  const remixScriptsStub: StubComponent = {
    displayName: "Scripts",
    render: (props) => {
      const crossOrigin = getObjectProperty(props, "crossOrigin");
      const modulePreload = (href: StaticValue): StaticValue =>
        hostElement("link", { rel: primitiveValue("modulepreload"), href, crossOrigin });
      const script = (attributes: Record<string, StaticValue>): StaticValue =>
        element(
          { kind: "host", tagName: "script" },
          objectValue([
            { kind: "spread", value: props },
            {
              kind: "spread",
              value: objectFromRecord({
                suppressHydrationWarning: primitiveValue(true),
                dangerouslySetInnerHTML: objectFromRecord({
                  __html: unknownPrimitiveValue("string", "remix hydration script"),
                }),
                ...attributes,
              }),
            },
          ]),
        );
      const manifestPreload = modulePreload(
        unknownPrimitiveValue("string", "remix browser manifest url"),
      );
      const isLazyRouteDiscovery = getTruthiness(
        framework.lazyRouteDiscovery ?? primitiveValue(false),
      );
      const hydrated = fragmentOf([
        isLazyRouteDiscovery === false
          ? manifestPreload
          : isLazyRouteDiscovery === true
            ? NULL_VALUE
            : branchValue(
                [manifestPreload, NULL_VALUE],
                "remix `future.v3_lazyRouteDiscovery` is not static",
                null,
              ),
        modulePreload(unknownPrimitiveValue("string", "remix client entry url")),
        listValue([
          unknownValue("remix: entry imports come from the build manifest"),
          ...Array.from({ length: framework.matchedRouteCount }, () =>
            modulePreload(unknownPrimitiveValue("string", "remix route module url")),
          ),
        ]),
        fragmentOf([
          script({ type: UNDEFINED_VALUE }),
          script({ type: primitiveValue("module"), async: primitiveValue(true) }),
        ]),
        listValue([]),
      ]);
      return branchValue(
        [hydrated, NULL_VALUE],
        "remix: <Scripts> renders null once a router update re-renders it",
        null,
      );
    },
  };
  // Server-rendered framework apps inline a scroll-restoring `<script>`; SPA
  // mode (and plain data routers) render nothing.
  const scrollRestorationStub: StubComponent = {
    displayName: "ScrollRestoration",
    render: (props) => {
      if (!framework.ssr) return NULL_VALUE;
      const isSpaMode = getTruthiness(framework.ssr);
      if (isSpaMode === false) return NULL_VALUE;
      const script = element(
        { kind: "host", tagName: "script" },
        objectValue([
          { kind: "spread", value: omitProps(props, SCROLL_RESTORATION_PROPS) },
          { kind: "property", key: "suppressHydrationWarning", value: primitiveValue(true) },
          {
            kind: "property",
            key: "dangerouslySetInnerHTML",
            value: objectFromRecord({
              __html: unknownPrimitiveValue("string", "inline scroll restoration script"),
            }),
          },
        ]),
      );
      if (isSpaMode === true) return script;
      return branchValue([script, NULL_VALUE], "react-router.config `ssr` is not static", null);
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
        ),
        pathname,
        observed,
      );
    },
  };
  const routerStub = (displayName: string): StubComponent => ({
    displayName,
    render: (props) => withinRouter(getObjectProperty(props, "children"), pathname, observed),
  });
  const routesStub: StubComponent = {
    displayName: "Routes",
    render: (props, tools) =>
      renderMatchedRoutes(
        readRouteElements(getObjectProperty(props, "children"), (lazy) =>
          tools.callAwaited(lazy, []),
        ),
        pathname,
      ),
  };

  const routerValue = (specifier: string, importedName: string): StaticValue | null => {
    const isRemix = specifier === REMIX_REACT_PACKAGE;
    switch (importedName) {
      case "createBrowserRouter":
      case "createHashRouter":
      case "createMemoryRouter":
      case "createStaticRouter":
        return createRouterFactory(importedName);
      case "RouterProvider":
        return stubValue(routerProviderStub);
      case "Routes":
        return stubValue(routesStub);
      case "Route":
        return stubValue(ROUTE_STUB);
      case "Outlet":
        return stubValue(OUTLET_STUB);
      case "Link":
        return stubValue(isRemix ? REMIX_LINK_STUB : LINK_STUB);
      case "NavLink":
        return stubValue(isRemix ? REMIX_NAV_LINK_STUB : NAV_LINK_STUB);
      case "Form":
        return stubValue(isRemix ? REMIX_FORM_STUB : FORM_STUB);
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
      case "PrefetchPageLinks":
        return stubValue(PREFETCH_PAGE_LINKS_STUB);
      case "Navigate":
      case "Scripts":
        return stubValue(isRemix ? remixScriptsStub : emptyStub(importedName));
      default:
        return routerHookValue(importedName, pathname, observed);
    }
  };

  return {
    pathname,
    observed,
    framework,
    hydratedRouter: hydratedRouterStub,
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
 * The framework options: `react-router.config.ts`/`remix.config.js`'s default
 * export, or the object passed to `vitePlugin()` from `@remix-run/dev` in
 * `vite.config.ts`. An empty object when the project has neither.
 */
const readFrameworkConfig = (
  interpreter: Interpreter,
  configModule: ModuleRecord | null,
  viteConfigModule: ModuleRecord | null,
): StaticValue => {
  if (configModule) {
    const config = interpreter.evaluateModuleExport(configModule, "default");
    return config.kind === "object"
      ? config
      : unknownValue(
          `${path.basename(configModule.filePath)} default export is not a static object`,
        );
  }
  if (!viteConfigModule) return objectValue();
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
  if (viteConfig.kind !== "object") return objectValue();
  const plugins = getObjectProperty(viteConfig, "plugins");
  if (plugins.kind !== "list") return objectValue();
  const flattened = plugins.items.flatMap((plugin) =>
    plugin.kind === "list" ? plugin.items : [plugin],
  );
  const isRemixPlugin = (plugin: StaticValue): boolean => {
    if (plugin.kind !== "object") return false;
    const name = getObjectProperty(plugin, "name");
    return name.kind === "primitive" && name.value === REMIX_VITE_PLUGIN_NAME;
  };
  return flattened.find(isRemixPlugin) ?? objectValue();
};

/** `ssr` from the framework config; defaults to `true` like `@react-router/dev`. */
const readSsrFlag = (config: StaticValue): StaticValue => {
  if (config.kind !== "object") return config;
  const ssr = getObjectProperty(config, "ssr");
  return isDefined(ssr) ? ssr : primitiveValue(true);
};

const readFutureFlag = (config: StaticValue, flag: string): StaticValue => {
  if (config.kind !== "object") return config;
  const future = getObjectProperty(config, "future");
  if (!isDefined(future)) return primitiveValue(false);
  if (future.kind !== "object") return future;
  const value = getObjectProperty(future, flag);
  return isDefined(value) ? value : primitiveValue(false);
};

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
  const configModule = CONFIG_MODULE_NAMES.map((name) =>
    renderer.loadModule(path.join(projectDirectory, name)),
  ).find((module) => module !== null);
  const viteConfigModule = VITE_CONFIG_MODULE_NAMES.map((name) =>
    renderer.loadModule(path.join(projectDirectory, name)),
  ).find((module) => module !== null);

  return renderer.renderWith((interpreter) => {
    const chain = bestMatch(routes, model.pathname);
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
    const matched = composeChain(chain, renderRoute);
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
    const config = readFrameworkConfig(interpreter, configModule ?? null, viteConfigModule ?? null);
    model.framework.ssr = readSsrFlag(config);
    model.framework.singleFetch = readFutureFlag(config, "v3_singleFetch");
    model.framework.lazyRouteDiscovery = readFutureFlag(config, "v3_lazyRouteDiscovery");
    model.framework.matchedRouteCount = matchedModules.length;
    model.framework.meta = leafMeta ?? listValue([]);
    model.framework.links = dedupeLinkDescriptors(
      matchedModules.flatMap(({ module }) => callExport(module, "links", []) ?? []),
    );

    const rootComponent = interpreter.evaluateModuleExport(rootModule, "default");
    const app = element(toElementType(rootComponent, "App"), routeProps({}, ROOT_ROUTE_ID));
    const rootElement = interpreter.graph.listExportNames(rootModule).includes("Layout")
      ? element(
          toElementType(interpreter.evaluateModuleExport(rootModule, "Layout"), "Layout"),
          objectFromRecord({ children: app }),
        )
      : app;
    model.framework.routeTree = renderedRoute(matched, {}, rootElement, ROOT_ROUTE_ID);

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
