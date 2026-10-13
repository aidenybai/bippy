import { getDisplayName, getReactWorkTagsForFiber, getType, hasMemoCache } from "bippy";
import type { Fiber } from "bippy";

const getProperty = (value: unknown, property: PropertyKey): unknown =>
  (typeof value === "object" || typeof value === "function") && value !== null
    ? Reflect.get(value, property)
    : undefined;

const getNamedValue = (value: unknown): string | null => {
  const displayName = getProperty(value, "displayName");
  if (typeof displayName === "string" && displayName) return displayName;
  const name = getProperty(value, "name");
  return typeof name === "string" && name ? name : null;
};

const getWrappedDisplayName = (fiber: Fiber, wrapperName: string): string => {
  const elementTypeName = getNamedValue(fiber.elementType);
  if (elementTypeName) return elementTypeName;
  const resolvedType = getType(fiber.type) ?? fiber.type;
  return `${wrapperName}(${getDisplayName(resolvedType) ?? "Anonymous"})`;
};

const getContextDisplayName = (fiber: Fiber, suffix: string): string => {
  const context =
    getProperty(fiber.type, "_context") ?? getProperty(fiber.type, "context") ?? fiber.type;
  const displayName = getProperty(context, "displayName");
  return `${typeof displayName === "string" && displayName ? displayName : "Context"}.${suffix}`;
};

const getBaseFiberDisplayName = (fiber: Fiber): string | null => {
  const workTags = getReactWorkTagsForFiber(fiber);

  switch (fiber.tag) {
    case workTags.ActivityComponent:
      return "Activity";
    case workTags.CacheComponent:
      return "Cache";
    case workTags.ClassComponent:
    case workTags.IncompleteClassComponent:
    case workTags.IncompleteFunctionComponent:
    case workTags.FunctionComponent:
    case workTags.IndeterminateComponent:
      return getDisplayName(fiber.type);
    case workTags.ForwardRef:
      return getWrappedDisplayName(fiber, "ForwardRef");
    case workTags.HostRoot: {
      const debugRootType = getProperty(fiber.stateNode, "_debugRootType");
      return typeof debugRootType === "string" && debugRootType ? debugRootType : "Root";
    }
    case workTags.HostComponent:
    case workTags.HostHoistable:
    case workTags.HostSingleton:
      return typeof fiber.type === "string" ? fiber.type : null;
    case workTags.Fragment:
      return "Fragment";
    case workTags.LazyComponent:
      return "Lazy";
    case workTags.MemoComponent:
    case workTags.SimpleMemoComponent:
      return getWrappedDisplayName(fiber, "Memo");
    case workTags.ContextConsumer:
      return getContextDisplayName(fiber, "Consumer");
    case workTags.ContextProvider:
      return getContextDisplayName(fiber, "Provider");
    case workTags.SuspenseComponent:
      return "Suspense";
    case workTags.LegacyHiddenComponent:
      return "LegacyHidden";
    case workTags.OffscreenComponent:
      return "Offscreen";
    case workTags.ScopeComponent:
      return "Scope";
    case workTags.SuspenseListComponent:
      return "SuspenseList";
    case workTags.Profiler: {
      const profilerId = getProperty(fiber.memoizedProps, "id");
      return profilerId === undefined ? "Profiler" : `Profiler(${String(profilerId)})`;
    }
    case workTags.TracingMarkerComponent:
      return "TracingMarker";
    case workTags.ViewTransitionComponent:
      return "ViewTransition";
    case workTags.Throw:
      return "Error";
    default:
      return null;
  }
};

export const getFiberDisplayName = (fiber: Fiber): string | null => {
  const displayName = getBaseFiberDisplayName(fiber);
  if (!displayName) return null;
  return hasMemoCache(fiber) ? `Forget(${displayName})` : displayName;
};

export const getFiberTypeName = (fiber: Fiber): string => {
  const workTags = getReactWorkTagsForFiber(fiber);

  switch (fiber.tag) {
    case workTags.FunctionComponent:
    case workTags.IncompleteFunctionComponent:
    case workTags.IndeterminateComponent:
      return "function";
    case workTags.ClassComponent:
    case workTags.IncompleteClassComponent:
      return "class";
    case workTags.HostComponent:
    case workTags.HostHoistable:
    case workTags.HostSingleton:
      return "host";
    case workTags.HostRoot:
      return "root";
    case workTags.ForwardRef:
      return "forwardRef";
    case workTags.MemoComponent:
    case workTags.SimpleMemoComponent:
      return "memo";
    case workTags.ContextConsumer:
    case workTags.ContextProvider:
      return "context";
    case workTags.SuspenseComponent:
      return "suspense";
    case workTags.SuspenseListComponent:
      return "suspenseList";
    case workTags.LazyComponent:
      return "lazy";
    case workTags.Profiler:
      return "profiler";
    case workTags.HostPortal:
      return "portal";
    case workTags.ActivityComponent:
      return "activity";
    case workTags.ViewTransitionComponent:
      return "viewTransition";
    case workTags.CacheComponent:
      return "cache";
    case workTags.ScopeComponent:
      return "scope";
    case workTags.OffscreenComponent:
    case workTags.LegacyHiddenComponent:
      return "offscreen";
    case workTags.Throw:
      return "throw";
    case workTags.HostText:
      return "text";
    case workTags.Fragment:
      return "fragment";
    case workTags.DehydratedSuspenseComponent:
      return "dehydrated";
    case workTags.Mode:
      return "mode";
    default:
      return "unknown";
  }
};
