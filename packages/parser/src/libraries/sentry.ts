import { getObjectProperty, objectValue, primitiveValue } from "../evaluate/values.js";
import { element, nativeFunction, passthroughStub, stubValue } from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ExternalValueProvider,
  StaticElementType,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ClassComponentTag } from "../work-tags.js";

// Static stand-in for the render-affecting surface of `@sentry/react`. The SDK
// mostly instruments (spans, breadcrumbs) without adding fibers: the router
// wrappers return a router built by the wrapped `create*Router`, and its
// boundary/profiler components render their children until an error is caught.

export const SENTRY_PACKAGES = ["@sentry/react"];

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

export const sentryValue: ExternalValueProvider = (specifier, importedName) => {
  if (specifier !== "@sentry/react") return null;
  switch (importedName) {
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
