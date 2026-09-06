import { type FrameworkKind, type FrameworkProfile, SPA_PROFILE } from "./framework-profile.js";

// Names observed in Next 15/16 development builds (app router). Everything here
// is framework plumbing that wraps application output without rendering host
// nodes of its own; `Fragment` is flattened on both sides because Next inserts
// bare fragments around segments and the static side cannot know where.
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
  "InnerScrollHandlerNew",
  "InnerScrollAndFocusHandler",
  "LoadingBoundary",
  "TemplateContext",
  "LayoutRouterContext",
  "GlobalLayoutRouterContext",
  "AppRouterContext",
  "NavigationPromisesContext",
  "PathParamsContext",
  "PathnameContext",
  "SearchParamsContext",
  "HeadManagerContext",
  "Fragment",
];

export const NEXT_APP_PROFILE: FrameworkProfile = {
  kind: "next-app",
  transparentRuntimeFibers: new Set(NEXT_APP_RUNTIME_WRAPPERS),
  transparentStaticFibers: new Set(["Fragment"]),
  defaultAnchor: "body",
};

const NEXT_PAGES_RUNTIME_WRAPPERS = [
  "Root",
  "AppContainer",
  "Container",
  "PathnameContextProviderAdapter",
  "RouterContext",
  "HeadManagerContext",
  "ImageConfigContext",
  "AppRouterContext",
  "SearchParamsContext",
  "PathnameContext",
  "PathParamsContext",
  "ErrorBoundary",
  "HotReload",
  "ReactDevOverlay",
  "PagesDevOverlay",
  "PagesDevOverlayErrorBoundary",
  "Fragment",
];

export const NEXT_PAGES_PROFILE: FrameworkProfile = {
  kind: "next-pages",
  transparentRuntimeFibers: new Set(NEXT_PAGES_RUNTIME_WRAPPERS),
  transparentStaticFibers: new Set(["Fragment"]),
  defaultAnchor: null,
};

// React Router 6.4+/7/8 (names observed against react-router 8 in the fixture
// suite). The static adapter models the per-match structure itself
// (`RouterProvider`/`Routes` -> `RenderedRoute` -> `Route` provider -> component,
// `Outlet` -> anonymous OutletContext provider, `NavLink` -> `Link` -> `a`), so
// only the router's own context stack and error boundary are transparent.
const REACT_ROUTER_RUNTIME_WRAPPERS = [
  "Router",
  "DataRoutes",
  "RenderErrorBoundary",
  "DataRouter",
  "DataRouterState",
  "Fetchers",
  "ViewTransition",
  "Navigation",
  "Location",
  "RouteError",
  "AwaitContextProvider",
  // framework mode (`@react-router/dev`)
  "HydratedRouter",
  "FrameworkContext",
  "RSCRouterContext",
  "RSCRouterGlobalErrorBoundary",
];

export const REACT_ROUTER_PROFILE: FrameworkProfile = {
  kind: "react-router",
  transparentRuntimeFibers: new Set(REACT_ROUTER_RUNTIME_WRAPPERS),
  transparentStaticFibers: new Set(),
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
