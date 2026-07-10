export const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export const INTERNAL_SCHEME_PREFIXES = [
  "rsc://",
  "file:///",
  "webpack-internal://",
  "webpack://",
  "node:",
  "turbopack://",
  "metro://",
  "/app-pages-browser/",
  "/(app-pages-browser)/",
] as const;

export const ABOUT_REACT_PREFIX = "about://React/";

export const SERVER_COMPONENT_URL_PREFIXES = ["rsc://", ABOUT_REACT_PREFIX] as const;

export const ANONYMOUS_FILE_PATTERNS = ["<anonymous>", "eval", ""] as const;

export const SOURCE_FILE_EXTENSION_REGEX = /\.(jsx|tsx|ts|js)$/;

export const BUNDLED_FILE_PATTERN_REGEX =
  /(\.min|bundle|chunk|vendor|vendors|runtime|polyfill|polyfills)\.(js|mjs|cjs)$|(chunk|bundle|vendor|vendors|runtime|polyfill|polyfills|framework|app|main|index)[-_.][A-Za-z0-9_-]{4,}\.(js|mjs|cjs)$|[\da-f]{8,}\.(js|mjs|cjs)$|[-_.][\da-f]{20,}\.(js|mjs|cjs)$|\/dist\/|\/build\/|\/.next\/|\/out\/|\/node_modules\/|\.webpack\.|\.vite\.|\.turbopack\./i;

export const QUERY_PARAMETER_PATTERN_REGEX = /^\?[\w~.-]+(?:=[^&#]*)?(?:&[\w~.-]+(?:=[^&#]*)?)*$/;

export const SERVER_FRAME_MARKER = "(at Server)";

export const SERVER_ENV_PATTERN = /\(at [^)]+\)$/;

export const REACT_STACK_BOTTOM_FRAME_PATTERNS = [
  "react_stack_bottom_frame",
  "react-stack-bottom-frame",
] as const;

// the first frame of a _debugStack is the JSX factory itself (jsxDEV), never
// user code, matching what react's own captureOwnerStack pops
export const JSX_FACTORY_FRAME_COUNT = 1;
