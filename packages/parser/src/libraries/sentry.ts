import {
  getObjectProperty,
  mapValue,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { element, nativeFunction, passthroughStub, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ExternalValueProvider,
  StaticElementType,
  StaticObjectEntry,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ClassComponentTag } from "../work-tags.js";

// Static stand-in for the render-affecting surface of `@sentry/react`. The SDK
// mostly instruments (spans, breadcrumbs) without adding fibers: the router
// wrappers return a router built by the wrapped `create*Router`, and its
// boundary/profiler components render their children until an error is caught.

export const SENTRY_PACKAGES = ["@sentry/react", "@sentry/nextjs"];

/** The `next.config` keys `withSentryConfig` rewrites for build-time instrumentation; the rest spread through. */
const SENTRY_BUILD_CONFIG_KEYS = [
  "env",
  "rewrites",
  "experimental",
  "serverExternalPackages",
  "productionBrowserSourceMaps",
  "webpack",
  "turbopack",
];

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

const sentryBuildConfigEntry = (key: string): StaticObjectEntry => ({
  kind: "property",
  key,
  value: unknownValue(`next.config ${key} as @sentry/nextjs's withSentryConfig rewrites it`),
});

const finalSentryConfig = (nextConfig: StaticValue): StaticValue =>
  mapValue(nextConfig, (alternative) => {
    if (alternative.kind !== "object" && alternative.kind !== "primitive") return alternative;
    const userConfig = alternative.kind === "object" ? alternative : objectValue();
    const compiler = getObjectProperty(userConfig, "compiler");
    return objectValue([
      { kind: "spread", value: userConfig },
      ...SENTRY_BUILD_CONFIG_KEYS.map(sentryBuildConfigEntry),
      {
        kind: "property",
        key: "compiler",
        value:
          compiler.kind === "object"
            ? objectValue([
                { kind: "spread", value: compiler },
                sentryBuildConfigEntry("runAfterProductionCompile"),
              ])
            : compiler,
      },
    ]);
  });

const withSentryConfig = (): StaticValue =>
  nativeFunction("withSentryConfig", ([nextConfig = objectValue()]) => {
    const isFunctionConfig =
      nextConfig.kind === "function" || nextConfig.kind === "native-function";
    if (!isFunctionConfig) return finalSentryConfig(nextConfig);
    return nativeFunction("sentryNextConfig", (args, tools) =>
      finalSentryConfig(tools.callAwaited(nextConfig, args)),
    );
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

export const sentryValue: ExternalValueProvider = (specifier, importedName) => {
  if (!SENTRY_PACKAGES.includes(specifier)) return null;
  switch (importedName) {
    case "withSentryConfig":
      return specifier === "@sentry/nextjs" ? withSentryConfig() : null;
    case "wrapCreateBrowserRouterV6":
    case "wrapCreateBrowserRouterV7":
    case "wrapCreateMemoryRouterV6":
    case "wrapCreateMemoryRouterV7":
      return wrapCreateRouter(importedName);
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
