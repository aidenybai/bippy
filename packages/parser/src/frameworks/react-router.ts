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
  unknownValue,
} from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import { findRootRenderCalls } from "../render/find-root-elements.js";
import { AUTO_ROUTES_PACKAGE, readAutoRoutes } from "./react-router-auto-routes.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type {
  ContextDefinition,
  ExternalValueProvider,
  StaticElementValue,
  StaticObjectValue,
  StaticRenderResult,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ForwardRefTag } from "../work-tags.js";
import { splitPathname } from "./route-files.js";
import { element, emptyStub, nativeFunction, passthroughStub, stubValue } from "./stubs.js";

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
  externalValues: ExternalValueProvider;
}

const ROUTER_PACKAGES = new Set([
  "react-router",
  "react-router/dom",
  "react-router-dom",
  "@remix-run/react",
]);
const ROUTE_CONFIG_PACKAGE = "@react-router/dev/routes";

/**
 * Mirrors React Router's `RouteContext` (displayName `Route`). The static
 * provider value is `{ outlet, params }`: the element for the matched child
 * route and the params accumulated down to this match.
 */
export const ROUTE_CONTEXT: ContextDefinition = {
  name: "RouteContext",
  displayName: "Route",
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
  path: null,
  index: false,
  element: null,
  component: null,
  file: null,
  children: [],
  uncertainty,
});

/** Evaluates a route's `lazy` function as the router does when it awaits the route module; null when unavailable. */
type LazyResolver = ((lazy: StaticValue) => StaticValue) | null;

interface RouteContent {
  element: StaticValue | null;
  component: StaticValue | null;
  uncertainty: string | null;
}

/** Route module fields (`element`, `Component`), taking `lazy`'s awaited module as a fallback source. */
const readRouteContent = (
  fields: StaticObjectValue,
  lazy: StaticValue,
  resolveLazy: LazyResolver,
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

const readRouteObject = (value: StaticValue, resolveLazy: LazyResolver): RouteRecord => {
  if (value.kind !== "object") return uncertainRoute(`route is ${value.kind}`);
  const hasSpread = value.entries.some((entry) => entry.kind === "spread");
  const content = readRouteContent(value, getObjectProperty(value, "lazy"), resolveLazy);
  return {
    path: readString(getObjectProperty(value, "path")),
    index: getTruthiness(getObjectProperty(value, "index")) === true,
    element: content.element,
    component: content.component,
    file: readString(getObjectProperty(value, "file")),
    children: readRouteList(getObjectProperty(value, "children"), resolveLazy),
    uncertainty: hasSpread ? "route object has a spread" : content.uncertainty,
  };
};

const readRouteList = (value: StaticValue, resolveLazy: LazyResolver): RouteRecord[] => {
  if (value.kind === "list") return value.items.map((item) => readRouteObject(item, resolveLazy));
  if (value.kind === "primitive") return [];
  return [uncertainRoute(`route list is ${value.kind}`)];
};

/** `<Route path element>` elements nested under `<Routes>` are routes too (`createRoutesFromChildren`). */
const readRouteElements = (value: StaticValue, resolveLazy: LazyResolver): RouteRecord[] => {
  const elements = value.kind === "list" ? value.items : [value];
  const routes: RouteRecord[] = [];
  for (const item of elements) {
    if (item.kind === "element" && item.type.kind === "stub" && item.type.stub === ROUTE_STUB) {
      const props = item.props;
      const content = readRouteContent(props, getObjectProperty(props, "lazy"), resolveLazy);
      routes.push({
        path: readString(getObjectProperty(props, "path")),
        index: getTruthiness(getObjectProperty(props, "index")) === true,
        element: content.element,
        component: content.component,
        file: null,
        children: readRouteElements(getObjectProperty(props, "children"), resolveLazy),
        uncertainty: content.uncertainty,
      });
    } else if (item.kind === "element" && item.type.kind === "fragment") {
      routes.push(...readRouteElements(getObjectProperty(item.props, "children"), resolveLazy));
    } else if (item.kind !== "primitive") {
      routes.push(uncertainRoute(`route child is ${item.kind}`));
    }
  }
  return routes;
};

type RouteParams = Record<string, string>;

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
): StaticElementValue =>
  element(
    { kind: "stub", stub: RENDERED_ROUTE_STUB },
    objectFromRecord({
      routeContext: objectFromRecord({ outlet, params: paramsValue(params) }),
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
    outlet = renderedRoute(outlet, params, renderRoute(route, outlet));
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

const readRouteContext = (tools: StubRenderTools, field: "outlet" | "params"): StaticValue => {
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

const LINK_STUB: StubComponent = {
  displayName: "Link",
  tag: ForwardRefTag,
  render: (props) =>
    element(
      { kind: "host", tagName: "a" },
      objectFromRecord({
        href: unknownValue("href is resolved by the router"),
        children: getObjectProperty(props, "children"),
      }),
    ),
};

/** `NavLink` renders a `Link` after computing its active state; `children` may be a render function. */
const NAV_LINK_STUB: StubComponent = {
  displayName: "NavLink",
  tag: ForwardRefTag,
  render: (props) => {
    const children = getObjectProperty(props, "children");
    return element(
      { kind: "stub", stub: LINK_STUB },
      objectFromRecord({
        children:
          children.kind === "function"
            ? unknownValue("NavLink children render function")
            : children,
      }),
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

const routerHookValue = (importedName: string, pathname: string): StaticValue | null => {
  switch (importedName) {
    case "useParams":
      return nativeFunction(importedName, (_args, tools) => readRouteContext(tools, "params"));
    case "useOutlet":
      return nativeFunction(importedName, (_args, tools) => readRouteContext(tools, "outlet"));
    case "useOutletContext":
      return nativeFunction(importedName, (_args, tools) => tools.readContext(OUTLET_CONTEXT));
    case "useLocation":
      return nativeFunction(importedName, () =>
        objectFromRecord({
          pathname: primitiveValue(pathname),
          search: primitiveValue(""),
          hash: primitiveValue(""),
          state: NULL_VALUE,
          key: unknownValue("location key is assigned at runtime"),
        }),
      );
    case "useNavigate":
      return nativeFunction(importedName, () => nativeFunction("navigate", () => UNDEFINED_VALUE));
    case "useNavigationType":
      return nativeFunction(importedName, () => primitiveValue("POP"));
    case "useInRouterContext":
      return nativeFunction(importedName, () => primitiveValue(true));
    default:
      return RUNTIME_ONLY_HOOKS.has(importedName)
        ? nativeFunction(importedName, () =>
            unknownValue(`react-router ${importedName}() is only known at runtime`),
          )
        : null;
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

export const createReactRouterModel = (pathname: string): ReactRouterModel => {
  const routerProviderStub: StubComponent = {
    displayName: "RouterProvider",
    render: (props, tools) => {
      const router = getObjectProperty(props, "router");
      if (router.kind !== "object") {
        return unknownValue("react-router: router object was not created statically");
      }
      const resolveLazy: LazyResolver = (lazy) => tools.callAwaited(lazy, []);
      return renderMatchedRoutes(
        readRouteList(getObjectProperty(router, "routes"), resolveLazy),
        pathname,
      );
    },
  };
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

  const routerValue = (importedName: string): StaticValue | null => {
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
        return stubValue(LINK_STUB);
      case "NavLink":
        return stubValue(NAV_LINK_STUB);
      case "Form":
        return stubValue(FORM_STUB);
      case "BrowserRouter":
      case "HashRouter":
      case "MemoryRouter":
      case "Router":
      case "unstable_HistoryRouter":
        return stubValue(passthroughStub(importedName));
      case "Navigate":
      case "ScrollRestoration":
      case "Scripts":
      case "Links":
      case "Meta":
      case "PrefetchPageLinks":
        return stubValue(emptyStub(importedName));
      default:
        return routerHookValue(importedName, pathname);
    }
  };

  return {
    pathname,
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
const renderFrameworkRoutes = (
  renderer: StaticRenderer,
  model: ReactRouterModel,
  routesModulePath: string,
  routes: RouteRecord[],
): StaticRenderResult => {
  const appDirectory = path.dirname(routesModulePath);
  const rootPath = ["root.tsx", "root.jsx", "root.ts", "root.js"]
    .map((name) => path.join(appDirectory, name))
    .find((candidate) => renderer.loadModule(candidate) !== null);
  const rootModule = rootPath ? renderer.loadModule(rootPath) : null;

  return renderer.renderWith((interpreter) => {
    const chain = bestMatch(routes, model.pathname);
    if (!chain) {
      interpreter.report(
        "react-router-no-match",
        `no route in ${routesModulePath} matches ${model.pathname}`,
        null,
        "error",
      );
      return unknownValue(`react-router: no route matches ${model.pathname}`);
    }
    const routeProps = (params: RouteParams): StaticObjectValue =>
      objectFromRecord({
        loaderData: unknownValue("loader data is only known at request time"),
        params: paramsValue(params),
        matches: unknownValue("route matches are only known at request time"),
      });
    const leafParams = chain[chain.length - 1].params;
    const renderRoute = (route: RouteRecord, outlet: StaticValue): StaticValue => {
      if (!route.file) return outlet;
      const module = renderer.loadModule(path.join(appDirectory, route.file));
      if (!module) {
        interpreter.report("react-router-parse", `could not parse ${route.file}`, null, "error");
        return unknownValue(`unparsable route module ${route.file}`);
      }
      // Resource routes (loader/action only) render nothing of their own.
      if (!interpreter.graph.listExportNames(module).includes("default")) return outlet;
      const component = interpreter.evaluateModuleExport(module, "default");
      const params = chain.find((match) => match.route === route)?.params ?? leafParams;
      return element(
        toElementType(component, path.basename(route.file, path.extname(route.file))),
        routeProps(params),
      );
    };
    const matched = composeChain(chain, renderRoute);
    if (!rootModule) return matched;

    const rootComponent = interpreter.evaluateModuleExport(rootModule, "default");
    const app = renderedRoute(
      matched,
      {},
      element(toElementType(rootComponent, "App"), routeProps({})),
    );
    const layout = interpreter.evaluateModuleExport(rootModule, "Layout");
    if (!isDefined(layout)) return app;
    return element(toElementType(layout, "Layout"), objectFromRecord({ children: app }));
  });
};

export const renderReactRouterRoute = (
  renderer: StaticRenderer,
  model: ReactRouterModel,
  options: ReactRouterRouteOptions,
): StaticRenderResult => {
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

  const probed: { routes: RouteRecord[] | null } = { routes: null };
  const probe = renderer.renderWith((interpreter) => {
    const config = interpreter.evaluateModuleExport(module, "default");
    if (config.kind === "list") probed.routes = readRouteList(config, null);
    else if (
      config.kind === "external" &&
      config.packageName === AUTO_ROUTES_PACKAGE &&
      config.importedName === "autoRoutes()"
    ) {
      probed.routes = readAutoRoutes(path.dirname(modulePath));
    }
    return NULL_VALUE;
  });
  if (probed.routes === null) {
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
  return renderFrameworkRoutes(renderer, model, modulePath, probed.routes);
};
