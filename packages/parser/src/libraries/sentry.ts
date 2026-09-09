import {
  UNDEFINED_VALUE,
  getObjectProperty,
  objectValue,
  primitiveValue,
} from "../evaluate/values.js";
import { element, nativeFunction, passthroughStub, stubValue } from "../frameworks/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  LibraryValueProvider,
  ProjectContext,
  StaticElementType,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ClassComponentTag } from "../work-tags.js";

// Static stand-in for the render-affecting surface of `@sentry/react`. The SDK
// mostly instruments (spans, breadcrumbs) without adding fibers: the router
// wrappers return a router built by the wrapped `create*Router`, and its
// boundary/profiler components render their children until an error is caught.
// `withSentryReactRouterV6Routing(Routes)` only wraps once `init` has set up a
// router tracing integration carrying every router hook; before that it hands
// `Routes` back unchanged.

export const SENTRY_PACKAGES = ["@sentry/react"];

const ROUTER_HOOK_OPTIONS = [
  "useEffect",
  "useLocation",
  "useNavigationType",
  "createRoutesFromChildren",
  "matchRoutes",
];

const routerIntegrations = new WeakSet<StaticValue>();
const projectsWithRouterInstrumentation = new WeakSet<ProjectContext>();

const isDefinedProperty = (options: StaticObjectValue, key: string): boolean => {
  const property = getObjectProperty(options, key);
  return property.kind !== "primitive" || property.value !== undefined;
};

const reactRouterBrowserTracingIntegration = (name: string): StaticValue =>
  nativeFunction(name, ([options]) => {
    const integration = objectValue([
      { kind: "property", key: "name", value: primitiveValue("BrowserTracing") },
    ]);
    if (
      options?.kind === "object" &&
      ROUTER_HOOK_OPTIONS.every((key) => isDefinedProperty(options, key))
    ) {
      routerIntegrations.add(integration);
    }
    return integration;
  });

const init = (project: ProjectContext): StaticValue =>
  nativeFunction("init", ([options]) => {
    const integrations =
      options?.kind === "object" ? getObjectProperty(options, "integrations") : undefined;
    if (
      integrations?.kind === "list" &&
      integrations.items.some((item) => routerIntegrations.has(item))
    ) {
      projectsWithRouterInstrumentation.add(project);
    }
    return UNDEFINED_VALUE;
  });

const withSentryReactRouterRouting = (name: string, project: ProjectContext): StaticValue =>
  nativeFunction(name, ([routes]) => {
    if (!routes || !projectsWithRouterInstrumentation.has(project)) {
      return routes ?? UNDEFINED_VALUE;
    }
    const inner = toElementType(routes, null);
    const wrapped: StubComponent = {
      displayName: "SentryRoutes",
      render: (props) => element(inner, objectValue([{ kind: "spread", value: props }])),
    };
    return stubValue(wrapped);
  });

const wrapUseRoutes = (name: string): StaticValue =>
  nativeFunction(name, ([useRoutes]) =>
    nativeFunction("sentryUseRoutes", (args, tools) => tools.call(useRoutes, args)),
  );

const ERROR_BOUNDARY_STUB: StubComponent = {
  ...passthroughStub("ErrorBoundary"),
  tag: ClassComponentTag,
};

const PROFILER_STUB: StubComponent = {
  ...passthroughStub("Profiler"),
  tag: ClassComponentTag,
};

const wrapCreateRouter = (name: string): StaticValue =>
  nativeFunction(name, ([createRouter]) =>
    nativeFunction("sentryCreateRouter", (args, tools) => tools.call(createRouter, args)),
  );

const withProfiler = (): StaticValue =>
  nativeFunction("withProfiler", ([component, options]) => {
    const inner = toElementType(component, null);
    const displayName = getComponentDisplayName(inner, options);
    const wrapped: StubComponent = {
      displayName: `profiler(${displayName})`,
      render: (props) =>
        element(
          { kind: "stub", stub: PROFILER_STUB },
          objectValue([
            { kind: "property", key: "name", value: primitiveValue(displayName) },
            {
              kind: "property",
              key: "children",
              value: element(inner, objectValue([{ kind: "spread", value: props }])),
            },
          ]),
        ),
    };
    return stubValue(wrapped);
  });

const withSentryRouting = (): StaticValue =>
  nativeFunction("withSentryRouting", ([route]) => {
    const inner = toElementType(route, null);
    const wrapped: StubComponent = {
      displayName: `sentryRoute(${getComponentDisplayName(inner, undefined)})`,
      render: (props) => element(inner, objectValue([{ kind: "spread", value: props }])),
    };
    return stubValue(wrapped);
  });

const getComponentDisplayName = (
  type: StaticElementType,
  options: StaticValue | undefined,
): string => {
  const optionName = options?.kind === "object" ? getObjectProperty(options, "name") : null;
  if (optionName?.kind === "primitive" && typeof optionName.value === "string") {
    return optionName.value;
  }
  switch (type.kind) {
    case "function":
    case "class":
    case "forward-ref":
      return type.component.name ?? "unknown";
    case "host":
      return type.tagName;
    case "external":
      return type.displayName;
    case "stub":
      return type.stub.displayName ?? "unknown";
    default:
      return "unknown";
  }
};

export const sentryValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (specifier !== "@sentry/react") return null;
  switch (importedName) {
    case "wrapCreateBrowserRouterV6":
    case "wrapCreateBrowserRouterV7":
    case "wrapCreateMemoryRouterV6":
    case "wrapCreateMemoryRouterV7":
      return wrapCreateRouter(importedName);
    case "wrapUseRoutesV6":
    case "wrapUseRoutesV7":
      return wrapUseRoutes(importedName);
    case "reactRouterV6BrowserTracingIntegration":
    case "reactRouterV7BrowserTracingIntegration":
      return reactRouterBrowserTracingIntegration(importedName);
    case "init":
      return init(project);
    case "withSentryReactRouterV6Routing":
    case "withSentryReactRouterV7Routing":
      return withSentryReactRouterRouting(importedName, project);
    case "ErrorBoundary":
      return stubValue(ERROR_BOUNDARY_STUB);
    case "Profiler":
      return stubValue(PROFILER_STUB);
    case "withProfiler":
      return withProfiler();
    case "withSentryRouting":
      return withSentryRouting();
    default:
      return null;
  }
};
