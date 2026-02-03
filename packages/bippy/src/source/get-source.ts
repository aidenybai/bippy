import { Fiber } from '../types.js';

import { FiberSource } from './types.js';
import {
  SCHEME_REGEX,
  INTERNAL_SCHEME_PREFIXES,
  ABOUT_REACT_PREFIX,
  ANONYMOUS_FILE_PATTERNS,
  SOURCE_FILE_EXTENSION_REGEX,
  BUNDLED_FILE_PATTERN_REGEX,
  QUERY_PARAMETER_PATTERN_REGEX,
} from './constants.js';
import { getOwnerStack } from './owner-stack.js';

export const hasDebugSource = (
  fiber: Fiber,
): fiber is Fiber & {
  _debugSource: NonNullable<Fiber['_debugSource']>;
} => {
  const debugSource = fiber._debugSource;
  if (!debugSource) {
    return false;
  }
  return (
    typeof debugSource === 'object' &&
    debugSource !== null &&
    'fileName' in debugSource &&
    typeof debugSource.fileName === 'string' &&
    'lineNumber' in debugSource &&
    typeof debugSource.lineNumber === 'number'
  );
};

/**
 * Returns the source of where the component is used. Available only in dev, for composite {@link Fiber}s.
 *
 * @example
 * ```ts
 * function Parent() {
 *   const data = useData();
 *   return <Child name={data.name} />; // <-- captures THIS line
 * }
 *
 * function Child({ name }) {
 *   return <div>{name}</div>;
 * }
 *
 * const source = await getSource(fiber);
 * console.log(source.fileName, source.lineNumber);
 * ```
 */
export const getSource = async (
  fiber: Fiber,
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<FiberSource | null> => {
  if (hasDebugSource(fiber)) {
    const debugSource = fiber._debugSource;
    return debugSource || null;
  }

  const componentStack = await getOwnerStack(fiber, cache, fetchFn);

  for (const stackFrame of componentStack) {
    if (stackFrame.fileName) {
      return {
        fileName: stackFrame.fileName,
        lineNumber: stackFrame.lineNumber,
        columnNumber: stackFrame.columnNumber,
        functionName: stackFrame.functionName,
      };
    }
  }
  return null;
};

const getPathSegmentCount = (path: string): number =>
  path.split('/').filter(Boolean).length;

const getFirstPathSegment = (path: string): string | null => {
  const segments = path.split('/').filter(Boolean);
  return segments[0] ?? null;
};

const stripSingleBasePathPrefix = (path: string): string => {
  const firstSlashIndex = path.indexOf('/', 1);
  if (firstSlashIndex === -1) {
    return path;
  }

  const basePath = path.slice(0, firstSlashIndex);
  if (getPathSegmentCount(basePath) !== 1) {
    return path;
  }

  const remainderPath = path.slice(firstSlashIndex);
  if (!SOURCE_FILE_EXTENSION_REGEX.test(remainderPath)) {
    return path;
  }

  if (getPathSegmentCount(remainderPath) < 2) {
    return path;
  }

  const firstRemainderSegment = getFirstPathSegment(remainderPath);
  if (!firstRemainderSegment) {
    return path;
  }

  if (firstRemainderSegment.startsWith('@')) {
    return path;
  }

  if (firstRemainderSegment.length > 4) {
    return path;
  }

  return remainderPath;
};

export const normalizeFileName = (fileName: string): string => {
  if (!fileName) {
    return '';
  }

  if (ANONYMOUS_FILE_PATTERNS.some((pattern) => pattern === fileName)) {
    return '';
  }

  let normalizedFileName = fileName;

  const isHttpUrl =
    normalizedFileName.startsWith('http://') ||
    normalizedFileName.startsWith('https://');
  if (isHttpUrl) {
    try {
      const parsedUrl = new URL(normalizedFileName);
      normalizedFileName = parsedUrl.pathname;
    } catch {}
  }

  if (isHttpUrl) {
    normalizedFileName = stripSingleBasePathPrefix(normalizedFileName);
  }

  if (normalizedFileName.startsWith(ABOUT_REACT_PREFIX)) {
    const remainder = normalizedFileName.slice(ABOUT_REACT_PREFIX.length);
    const slashIndex = remainder.indexOf('/');
    const colonIndex = remainder.indexOf(':');

    if (slashIndex !== -1 && (colonIndex === -1 || slashIndex < colonIndex)) {
      normalizedFileName = remainder.slice(slashIndex + 1);
    } else {
      normalizedFileName = remainder;
    }
  }

  let didStripPrefix = true;
  while (didStripPrefix) {
    didStripPrefix = false;
    for (const prefix of INTERNAL_SCHEME_PREFIXES) {
      if (normalizedFileName.startsWith(prefix)) {
        normalizedFileName = normalizedFileName.slice(prefix.length);

        if (prefix === 'file:///') {
          normalizedFileName = `/${normalizedFileName.replace(/^\/+/, '')}`;
        }

        didStripPrefix = true;
        break;
      }
    }
  }

  if (SCHEME_REGEX.test(normalizedFileName)) {
    const schemeMatch = normalizedFileName.match(SCHEME_REGEX);
    if (schemeMatch) {
      normalizedFileName = normalizedFileName.slice(schemeMatch[0].length);
    }
  }

  if (normalizedFileName.startsWith('//')) {
    const firstPathSlashIndex = normalizedFileName.indexOf('/', 2);
    normalizedFileName =
      firstPathSlashIndex === -1
        ? ''
        : normalizedFileName.slice(firstPathSlashIndex);
  }

  const queryParameterIndex = normalizedFileName.indexOf('?');
  if (queryParameterIndex !== -1) {
    const potentialQueryParameters =
      normalizedFileName.slice(queryParameterIndex);
    if (QUERY_PARAMETER_PATTERN_REGEX.test(potentialQueryParameters)) {
      normalizedFileName = normalizedFileName.slice(0, queryParameterIndex);
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
