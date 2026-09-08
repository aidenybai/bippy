import type { RuntimeFiberSnapshot } from "../harness/snapshot.js";
import { type FrameworkKind, type FrameworkProfile, SPA_PROFILE } from "./framework-profile.js";

// Names observed in Next 15/16 development builds (app router). Everything here
// is framework plumbing that wraps application output without rendering host
// nodes of its own; `Fragment` and anonymous `ContextProvider`s are flattened
// on both sides because Next inserts bare fragments and unnamed providers
// around segments and the static side cannot know where.
const NEXT_APP_RUNTIME_WRAPPERS = [
  "Root",
  "ServerRoot",
  "AppRouter",
  "RootErrorBoundary",
  "ErrorBoundary",
  "ErrorBoundaryHandler",
  "Router",
  "HistoryUpdater",
  "HotReload",
  "AppDevOverlayErrorBoundary",
  "ReactDevOverlay",
  "DevRootNotFoundBoundary",
  "NotFoundBoundary",
  "NotFoundErrorBoundary",
  "ReplaySsrOnlyErrors",
  "DevRootHTTPAccessFallbackBoundary",
  "HTTPAccessFallbackBoundary",
  "HTTPAccessFallbackErrorBoundary",
  "RedirectBoundary",
  "RedirectErrorBoundary",
  "__next_root_layout_boundary__",
  "SegmentViewNode",
  "SegmentTrieNode",
  "SegmentViewStateNode",
  "SegmentStateProvider",
  "OuterLayoutRouter",
  "InnerLayoutRouter",
  "RenderFromTemplateContext",
  "ScrollAndMaybeFocusHandler",
  "ScrollAndFocusHandler",
  "ClientPageRoot",
  "ClientSegmentRoot",
  "InnerScrollHandlerNew",
  "InnerScrollAndFocusHandler",
  "InnerScrollAndFocusHandlerOld",
  "LoadingBoundary",
  "Fragment",
];

const NEXT_APP_RUNTIME_PROVIDERS = [
  "TemplateContext",
  "LayoutRouterContext",
  "GlobalLayoutRouterContext",
  "AppRouterContext",
  "NavigationPromisesContext",
  "PathParamsContext",
  "PathnameContext",
  "SearchParamsContext",
  "HeadManagerContext",
  "SegmentStateContext",
  "ContextProvider",
];

// Subtrees Next renders around a segment with no source in the application:
// the parallel-route outlet boundary, segment trigger nodes, the route
// announcer, and the layer assets `get-layer-assets` emits next to each layout
// (`<script key="script-N">`, and `<link>`/`<style key={index}>` stylesheets
// from `render-css-resource`).
const NEXT_APP_INJECTED_FIBERS = new Set([
  "__next_outlet_boundary__",
  "SegmentBoundaryTriggerNode",
  "RouterAnnouncer",
]);
const NEXT_LAYER_SCRIPT_KEY = /^script-\d+$/;
const NEXT_LAYER_STYLE_KEY = /^\d+$/;

const isNextLayerAsset = (fiber: RuntimeFiberSnapshot): boolean => {
  if (fiber.tag !== "HostHoistable" || fiber.key === null) return false;
  if (fiber.name === "script") return NEXT_LAYER_SCRIPT_KEY.test(fiber.key);
  return (fiber.name === "link" || fiber.name === "style") && NEXT_LAYER_STYLE_KEY.test(fiber.key);
};

const isNextAppInjectedFiber = (fiber: RuntimeFiberSnapshot): boolean =>
  (fiber.name !== null && NEXT_APP_INJECTED_FIBERS.has(fiber.name)) || isNextLayerAsset(fiber);

export const NEXT_APP_PROFILE: FrameworkProfile = {
  kind: "next-app",
  transparentRuntimeFibers: new Set(NEXT_APP_RUNTIME_WRAPPERS),
  transparentRuntimeProviders: new Set(NEXT_APP_RUNTIME_PROVIDERS),
  transparentStaticFibers: new Set(["Fragment", "ContextProvider"]),
  isInjectedRuntimeFiber: isNextAppInjectedFiber,
  defaultAnchor: "body",
};

const NEXT_PAGES_RUNTIME_WRAPPERS = [
  "Root",
  "StrictMode",
  "AppContainer",
  "Container",
  "PathnameContextProviderAdapter",
  "ErrorBoundary",
  "HotReload",
  "ReactDevOverlay",
  "PagesDevOverlay",
  "PagesDevOverlayBridge",
  "PagesDevOverlayErrorBoundary",
  "Fragment",
];

const NEXT_PAGES_RUNTIME_PROVIDERS = [
  "RouterContext",
  "HeadManagerContext",
  "ImageConfigContext",
  "AppRouterContext",
  "SearchParamsContext",
  "PathnameContext",
  "PathParamsContext",
];

// `next/dist/client/index.js` mounts a dummy `<Head callback>` (renders null,
// times the head commit) and the route announcer portal next to `AppContainer`;
// `PagesDevOverlay` adds its font styles and overlay after the error boundary.
const NEXT_PAGES_INJECTED_FIBERS = new Set(["FontStyles", "DevOverlay"]);

const isNextPagesInjectedFiber = (fiber: RuntimeFiberSnapshot): boolean => {
  if (fiber.tag !== "FunctionComponent" || fiber.name === null) return false;
  if (NEXT_PAGES_INJECTED_FIBERS.has(fiber.name)) return true;
  if (fiber.name === "Head") {
    return fiber.children.length === 0 && Object.keys(fiber.props).join() === "callback";
  }
  return fiber.name === "Portal" && fiber.props.type === "next-route-announcer";
};

export const NEXT_PAGES_PROFILE: FrameworkProfile = {
  kind: "next-pages",
  transparentRuntimeFibers: new Set(NEXT_PAGES_RUNTIME_WRAPPERS),
  transparentRuntimeProviders: new Set(NEXT_PAGES_RUNTIME_PROVIDERS),
  transparentStaticFibers: new Set(["Fragment"]),
  isInjectedRuntimeFiber: isNextPagesInjectedFiber,
  defaultAnchor: null,
};

// React Router 6.4+/7/8 (names observed against react-router 8 in the fixture
// suite). The static adapter models the per-match structure itself
// (`RouterProvider`/`Routes` -> `RenderedRoute` -> `Route` provider -> component,
// `Outlet` -> anonymous OutletContext provider, `NavLink` -> `Link` -> `a`), so
// only the router's own context stack and error boundary are transparent. The
// static side provides `Location` (it backs `useInRouterContext`) and the
// `DataRouterState`/`FrameworkContext` re-render paths itself, so those are
// transparent on both sides.
const REACT_ROUTER_RUNTIME_WRAPPERS = [
  "Router",
  "DataRoutes",
  "DataRoutes2",
  "RenderErrorBoundary",
  "AwaitContextProvider",
  "AwaitErrorBoundary",
  // framework mode (`@react-router/dev`); `HydratedRouter` and `RouterProvider`
  // stay as fibers because the static side renders them (the bundler-renamed
  // `react-router/dom` re-export wrapper is spliced out generically).
  "RemixErrorBoundary",
  "WithComponentProps",
  "WithComponentProps2",
  "WithHydrateFallbackProps",
  "WithHydrateFallbackProps2",
  "WithErrorBoundaryProps",
  "WithErrorBoundaryProps2",
  "RSCRouterGlobalErrorBoundary",
];

const REACT_ROUTER_RUNTIME_PROVIDERS = [
  "DataRouter",
  "DataRouterState",
  "Fetchers",
  "ViewTransition",
  "Navigation",
  "Location",
  "RouteError",
  "FrameworkContext",
  "RSCRouterContext",
];

// `react-router-devtools`' Vite plugin rewrites the root route module in
// development so its default export renders next to the devtools panel
// (`withViteDevTools` in `react-router-devtools/client`).
const REACT_ROUTER_INJECTED_FIBERS = new Set(["TanStackDevtools"]);

const isReactRouterInjectedFiber = (fiber: RuntimeFiberSnapshot): boolean =>
  fiber.name !== null && REACT_ROUTER_INJECTED_FIBERS.has(fiber.name);

export const REACT_ROUTER_PROFILE: FrameworkProfile = {
  kind: "react-router",
  transparentRuntimeFibers: new Set(REACT_ROUTER_RUNTIME_WRAPPERS),
  transparentRuntimeProviders: new Set(REACT_ROUTER_RUNTIME_PROVIDERS),
  transparentStaticFibers: new Set(["Location", "DataRouterState", "FrameworkContext"]),
  isInjectedRuntimeFiber: isReactRouterInjectedFiber,
  defaultAnchor: null,
};

export const getFrameworkProfile = (kind: FrameworkKind): FrameworkProfile => {
  switch (kind) {
    case "spa":
      return SPA_PROFILE;
    case "next-app":
      return NEXT_APP_PROFILE;
    case "next-pages":
      return NEXT_PAGES_PROFILE;
    case "react-router":
      return REACT_ROUTER_PROFILE;
  }
};
