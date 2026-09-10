import {
  UNDEFINED_VALUE,
  describeValue,
  getObjectProperty,
  getTruthiness,
  mapValue,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction, passthroughStub, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  LibraryValueProvider,
  LibraryRun,
  StaticElementType,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ClassComponentTag } from "../work-tags.js";

// Static stand-in for the render-affecting surface of `@sentry/react` (which
// `@sentry/nextjs` re-exports). The SDK mostly instruments (spans, breadcrumbs)
// without adding fibers: the router wrappers return a router built by the
// wrapped `create*Router`, and its boundary/profiler components render their
// children until an error is caught.
// `withSentryReactRouterV6Routing(Routes)` only wraps once `init` has set up a
// router tracing integration carrying every router hook; before that it hands
// `Routes` back unchanged. `withSentryConfig` returns the user's `next.config`
// with the build plumbing Sentry patches in (webpack/turbopack hooks,
// source-map and tunnel rewrites, `env` variables), which depends on the
// installed Next version and the build invocation.

export const SENTRY_PACKAGES = ["@sentry/react", "@sentry/nextjs"];

const SENTRY_PATCHED_CONFIG_KEYS = [
  "env",
  "experimental",
  "productionBrowserSourceMaps",
  "rewrites",
  "serverExternalPackages",
  "turbopack",
  "webpack",
];

const ROUTER_HOOK_OPTIONS = [
  "useEffect",
  "useLocation",
  "useNavigationType",
  "createRoutesFromChildren",
  "matchRoutes",
];

const routerIntegrations = new WeakSet<StaticValue>();
const runsWithRouterInstrumentation = new WeakSet<LibraryRun>();

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

const init = (run: LibraryRun): StaticValue =>
  nativeFunction("init", ([options]) => {
    const integrations =
      options?.kind === "object" ? getObjectProperty(options, "integrations") : undefined;
    if (
      integrations?.kind === "list" &&
      integrations.items.some((item) => routerIntegrations.has(item))
    ) {
      runsWithRouterInstrumentation.add(run);
    }
    return UNDEFINED_VALUE;
  });

const withSentryReactRouterRouting = (name: string, run: LibraryRun): StaticValue =>
  nativeFunction(name, ([routes]) => {
    if (!routes || !runsWithRouterInstrumentation.has(run)) {
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

const patchNextConfig = (config: StaticValue): StaticValue =>
  mapValue(config, (alternative) => {
    const userConfig = getTruthiness(alternative) === false ? objectValue() : alternative;
    if (userConfig.kind === "unknown") return userConfig;
    if (userConfig.kind !== "object") {
      return unknownValue(`withSentryConfig() over ${describeValue(userConfig)}`);
    }
    return objectValue([
      { kind: "spread", value: userConfig },
      ...SENTRY_PATCHED_CONFIG_KEYS.map((key): StaticObjectEntry => ({
        kind: "property",
        key,
        value: unknownValue(`next.config ${key} as patched by withSentryConfig()`),
      })),
      {
        kind: "property",
        key: "compiler",
        value: objectValue([
          { kind: "spread", value: getObjectProperty(userConfig, "compiler") },
          {
            kind: "property",
            key: "runAfterProductionCompile",
            value: unknownValue("withSentryConfig() production compile hook"),
          },
        ]),
      },
    ]);
  });

const withSentryConfig = (): StaticValue =>
  nativeFunction("withSentryConfig", ([nextConfig], tools) => {
    const config = nextConfig ?? objectValue();
    if (config.kind === "function" || config.kind === "native-function") {
      return nativeFunction("sentryNextConfig", (args) =>
        patchNextConfig(tools.callAwaited(config, args)),
      );
    }
    return patchNextConfig(config);
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

export const sentryValue: LibraryValueProvider = (specifier, importedName, run) => {
  if (!SENTRY_PACKAGES.includes(specifier)) return null;
  if (importedName === "withSentryConfig") {
    return specifier === "@sentry/nextjs" ? withSentryConfig() : null;
  }
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
      return init(run);
    case "withSentryReactRouterV6Routing":
    case "withSentryReactRouterV7Routing":
      return withSentryReactRouterRouting(importedName, run);
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
