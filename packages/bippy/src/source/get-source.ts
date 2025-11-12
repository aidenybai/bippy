import { parseStack } from './parse-stack.js';

import { Fiber } from '../types.js';
import { formatOwnerStack, getFallbackOwnerStack } from './component-stack.js';
import { getSourceFromSourceMap, getSourceMap } from './symbolication.js';
import { FiberSource } from './types.js';
import {
  getFiberFromHostInstance,
  isHostFiber,
  getLatestFiber,
  traverseFiber,
  isCompositeFiber,
} from '../core.js';
import {
  SCHEME_REGEX,
  INTERNAL_SCHEME_PREFIXES,
  ABOUT_REACT_PREFIX,
  ANONYMOUS_FILE_PATTERNS,
  SOURCE_FILE_EXTENSION_REGEX,
  BUNDLED_FILE_PATTERN_REGEX,
  QUERY_PARAMETER_PATTERN_REGEX,
} from './constants.js';

export const hasDebugStack = (
  fiber: Fiber,
): fiber is Fiber & {
  _debugStack: NonNullable<Fiber['_debugStack']>;
} => {
  return (
    fiber._debugStack instanceof Error &&
    typeof fiber._debugStack?.stack === 'string'
  );
};

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

  const ownerStack = getOwnerStack(fiber);

  return getSourceFromStack(
    ownerStack,
    undefined,
    cache,
    fetchFn,
  ) as Promise<FiberSource | null>;
};

export const getOwnerStack = (fiber: Fiber): string => {
  return hasDebugStack(fiber)
    ? formatOwnerStack(fiber._debugStack.stack)
    : getFallbackOwnerStack(fiber);
};

export const getSourceFromStack = async (
  ownerStack: string,
  slice?: number,
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<FiberSource | FiberSource[] | null> => {
  const stackFrames = parseStack(ownerStack, { slice: slice ?? 1 });
  const sources: FiberSource[] = [];

  for (const stackFrame of stackFrames) {
    if (!stackFrame?.file) {
      continue;
    }

    const bundleSourceMap = await getSourceMap(stackFrame.file, cache, fetchFn);
    if (
      bundleSourceMap &&
      typeof stackFrame.line === 'number' &&
      typeof stackFrame.col === 'number'
    ) {
      const source = getSourceFromSourceMap(
        bundleSourceMap,
        stackFrame.line,
        stackFrame.col,
      );
      if (source) {
        sources.push(source);
        continue;
      }
    }

    sources.push({
      fileName: stackFrame.file,
      lineNumber: stackFrame.line,
      columnNumber: stackFrame.col,
    });
  }

  return slice !== undefined ? sources : (sources[0] ?? null);
};

export const normalizeFileName = (fileName: string): string => {
  if (!fileName) {
    return '';
  }

  if (ANONYMOUS_FILE_PATTERNS.includes(fileName as never)) {
    return '';
  }

  let normalizedFileName = fileName;

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

  for (const prefix of INTERNAL_SCHEME_PREFIXES) {
    if (normalizedFileName.startsWith(prefix)) {
      normalizedFileName = normalizedFileName.slice(prefix.length);

      if (prefix === 'file:///') {
        normalizedFileName = `/${normalizedFileName.replace(/^\/+/, '')}`;
      }

      break;
    }
  }

  if (SCHEME_REGEX.test(normalizedFileName)) {
    const schemeMatch = normalizedFileName.match(SCHEME_REGEX);
    if (schemeMatch) {
      normalizedFileName = normalizedFileName.slice(schemeMatch[0].length);
    }
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

/**
 * Returns the nearest available source location for a {@link Fiber}. Traverses up the fiber tree to find the nearest composite fiber with a valid source file, falling back to stack parsing if needed.
 *
 * @example
 * ```ts
 * const source = await getNearestValidSource(hostFiber);
 * if (source) {
 *   console.log(`${source.fileName}:${source.lineNumber}:${source.columnNumber}`);
 * }
 * ```
 */
export const getNearestValidSource = async (
  fiber: Fiber,
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
) => {
  const nearestCompositeFiber = traverseFiber(
    fiber,
    (innerFiber) => {
      if (isCompositeFiber(innerFiber)) {
        return true;
      }
    },
    true,
  );

  if (nearestCompositeFiber) {
    const source = await getSource(nearestCompositeFiber, cache, fetchFn);
    if (source?.fileName) {
      const fileName = normalizeFileName(source.fileName);
      if (isSourceFile(fileName)) {
        return {
          fileName,
          lineNumber: source.lineNumber,
          columnNumber: source.columnNumber,
        };
      }
    }
  }

  const ownerStack = parseStack(getOwnerStack(fiber), {
    includeInElement: false,
  });

  let nearestFallbackSource: FiberSource | null = null;

  while (ownerStack.length) {
    const stackFrame = ownerStack.pop();
    if (!stackFrame || !stackFrame.raw || !stackFrame.file) {
      continue;
    }

    const source = await getSourceFromStack(
      stackFrame.raw,
      undefined,
      cache,
      fetchFn,
    );
    if (source && !Array.isArray(source)) {
      const fileName = normalizeFileName(source.fileName);
      return {
        fileName,
        lineNumber: source.lineNumber,
        columnNumber: source.columnNumber,
      };
    }
    const fileName = normalizeFileName(stackFrame.file);
    nearestFallbackSource = {
      fileName,
      lineNumber: stackFrame.line,
      columnNumber: stackFrame.col,
    };
  }

  return nearestFallbackSource;
};

/**
 * Returns the source location from a DOM node or element by finding its associated {@link Fiber} and traversing to the nearest available source.
 *
 * @example
 * ```ts
 * const element = document.querySelector('.my-component');
 * const source = await getSourceFromHostInstance(element);
 * if (source) {
 *   console.log(`Component defined at ${source.fileName}:${source.lineNumber}`);
 * }
 * ```
 */
export const getSourceFromHostInstance = async (
  target: Node | Element,
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<FiberSource | null> => {
  const maybeHostFiber = getFiberFromHostInstance(target);
  if (!maybeHostFiber || !isHostFiber(maybeHostFiber)) {
    return null;
  }
  const hostFiber = getLatestFiber(maybeHostFiber);

  if (!hostFiber) {
    return null;
  }

  return getNearestValidSource(hostFiber, cache, fetchFn);
};
