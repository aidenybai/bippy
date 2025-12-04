export const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export const INTERNAL_SCHEME_PREFIXES = [
  'rsc://',
  'file:///',
  'webpack://',
  'webpack-internal://',
  'node:',
  'turbopack://',
  'metro://',
  '/app-pages-browser/',
] as const;

export const ABOUT_REACT_PREFIX = 'about://React/';

export const ANONYMOUS_FILE_PATTERNS = ['<anonymous>', 'eval', ''] as const;

export const SOURCE_FILE_EXTENSION_REGEX = /\.(jsx|tsx|ts|js)$/;

export const BUNDLED_FILE_PATTERN_REGEX =
  /(\.min|bundle|chunk|vendor|vendors|runtime|polyfill|polyfills)\.(js|mjs|cjs)$|(chunk|bundle|vendor|vendors|runtime|polyfill|polyfills|framework|app|main|index)[-_.][A-Za-z0-9_-]{4,}\.(js|mjs|cjs)$|[\da-f]{8,}\.(js|mjs|cjs)$|[-_.][\da-f]{20,}\.(js|mjs|cjs)$|\/dist\/|\/build\/|\/.next\/|\/out\/|\/node_modules\/|\.webpack\.|\.vite\.|\.turbopack\./i;

export const QUERY_PARAMETER_PATTERN_REGEX =
  /^\?[\w~.\-]+(?:=[^&#]*)?(?:&[\w~.\-]+(?:=[^&#]*)?)*$/;

export const SERVER_FRAME_MARKER = '(at Server)';
