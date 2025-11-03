// has a scheme, e.g. http://, https://, file://, data:, etc.
// https://datatracker.ietf.org/doc/html/rfc3986#section-3.1
export const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const INTERNAL_SCHEME_PREFIXES = [
  'rsc://',
  'about:React',
  'file:///',
  'webpack://',
  'node:',
  'turbopack://',
  'metro://',
] as const;

const ANONYMOUS_FILE_PATTERNS = ['<anonymous>', 'eval', ''] as const;

const SOURCE_FILE_EXTENSION_REGEX = /\.(jsx|tsx|ts|js)$/;

const BUNDLED_FILE_PATTERN_REGEX =
  /\.(min|bundle|chunk|vendor|vendors|runtime|polyfill|polyfills)\.(js|mjs|cjs)$|(chunk|bundle|vendor|vendors|runtime|polyfill|polyfills|framework|app|main|index)[-_.][A-Za-z0-9_-]{4,}\.(js|mjs|cjs)$|[\da-f]{8,}\.(js|mjs|cjs)$|[-_.][\da-f]{20,}\.(js|mjs|cjs)$|\/dist\/|\/build\/|\/\.next\/|\/out\/|\.webpack\.|\.vite\.|\.turbopack\./i;

export const normalizeFileName = (fileName: string): string => {
  if (!fileName) {
    return '';
  }

  if (ANONYMOUS_FILE_PATTERNS.includes(fileName as never)) {
    return '';
  }

  let normalizedFileName = fileName;

  for (const prefix of INTERNAL_SCHEME_PREFIXES) {
    if (normalizedFileName.startsWith(prefix)) {
      normalizedFileName = normalizedFileName.slice(prefix.length);
      break;
    }
  }

  if (SCHEME_REGEX.test(normalizedFileName)) {
    const schemeMatch = normalizedFileName.match(SCHEME_REGEX);
    if (schemeMatch) {
      normalizedFileName = normalizedFileName.slice(schemeMatch[0].length);
    }
  }

  return normalizedFileName;
};

export const isSourceFile = (fileName: string): boolean => {
  const normalizedFileName = normalizeFileName(fileName);

  if (!normalizedFileName) {
    return false;
  }

  if (!SOURCE_FILE_EXTENSION_REGEX.test(normalizedFileName)) {
    return false;
  }

  if (BUNDLED_FILE_PATTERN_REGEX.test(normalizedFileName)) {
    return false;
  }

  return true;
};
