import { parseStack } from './parse-stack.js';

import { Fiber } from '../types.js';
import { formatOwnerStack, getFallbackOwnerStack } from './component-stack.js';
import {
  getSourceMap,
  lookupSourceFromSourceMap,
  type SourceMap,
} from './symbolication.js';
import { FiberSource } from './types.js';

const supportsWeakRef = typeof WeakRef !== 'undefined';

const sourceMapCache = new Map<string, null | SourceMap | WeakRef<SourceMap>>();
const pendingSourceMapFetches = new Map<
  string,
  null | Promise<null | SourceMap>
>();

const getCachedSourceMap = async (
  file: string,
  useCache = true,
): Promise<null | SourceMap> => {
  if (useCache && sourceMapCache.has(file)) {
    const cachedValue = sourceMapCache.get(file);
    if (cachedValue === null || cachedValue === undefined) {
      return null;
    }
    if (supportsWeakRef && cachedValue instanceof WeakRef) {
      const sourceMap = cachedValue.deref();
      if (sourceMap) {
        return sourceMap;
      }
      sourceMapCache.delete(file);
    } else {
      return cachedValue as SourceMap;
    }
  }

  if (useCache && pendingSourceMapFetches.has(file)) {
    return pendingSourceMapFetches.get(file)!;
  }

  const fetchPromise = getSourceMap(file);
  if (useCache) {
    pendingSourceMapFetches.set(file, fetchPromise);
  }

  const sourceMap = await fetchPromise;
  if (useCache) {
    pendingSourceMapFetches.delete(file);
  }

  if (useCache) {
    if (sourceMap === null) {
      sourceMapCache.set(file, null);
    } else {
      sourceMapCache.set(
        file,
        supportsWeakRef ? new WeakRef(sourceMap) : sourceMap,
      );
    }
  }

  return sourceMap;
};

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

export interface GetSourceOptions {
  cache?: boolean;
}

/**
 * gets the source of where the component is used. available only in dev, for composite fibers.
 *
 * ```
 * function Parent() {
 *   const data = useData();
 *   return <Child name={data.name} />; // <-- captures THIS line
 * }
 *
 * function Child({ name }) {
 *   return <div>{name}</div>;
 * }
 * ```
 */
export const getSource = async (
  fiber: Fiber,
  options?: GetSourceOptions,
): Promise<FiberSource | null> => {
  const shouldUseCache = options?.cache ?? true;
  if (hasDebugSource(fiber)) {
    const debugSource = fiber._debugSource;
    return debugSource || null;
  }

  const ownerStackString = hasDebugStack(fiber)
    ? formatOwnerStack(fiber._debugStack.stack)
    : getFallbackOwnerStack(fiber);
  const ownerStackFrames = parseStack(ownerStackString, { slice: 1 });
  const nearestOwnerFrame = ownerStackFrames[0];
  if (!nearestOwnerFrame?.file) {
    return null;
  }
  const bundleSourceMap = await getCachedSourceMap(
    nearestOwnerFrame.file,
    shouldUseCache,
  );
  if (!bundleSourceMap || !nearestOwnerFrame.line || !nearestOwnerFrame.col) {
    return null;
  }
  const mappedSource = lookupSourceFromSourceMap(
    bundleSourceMap,
    nearestOwnerFrame.line,
    nearestOwnerFrame.col,
  );
  return mappedSource;
};

export const getOwnerStackSources = async (
  fiber: Fiber,
  options?: GetSourceOptions,
): Promise<(Partial<FiberSource> & { functionName?: string })[]> => {
  const shouldUseCache = options?.cache ?? true;
  const ownerStackString = getFallbackOwnerStack(fiber);
  const ownerStackFrames = parseStack(ownerStackString, {
    includeInElement: true,
  });

  const mappedEntries = await Promise.all(
    ownerStackFrames.map(async (ownerFrame) => {
      if (!ownerFrame.file || !ownerFrame.line || !ownerFrame.col) {
        return {
          fileName: ownerFrame.file,
          lineNumber: ownerFrame.line,
          columnNumber: ownerFrame.col,
          functionName: ownerFrame.function,
        };
      }
      const bundleSourceMap = await getCachedSourceMap(
        ownerFrame.file,
        shouldUseCache,
      );
      const source = bundleSourceMap
        ? lookupSourceFromSourceMap(
            bundleSourceMap,
            ownerFrame.line,
            ownerFrame.col,
          )
        : null;
      return {
        fileName: source?.fileName ?? ownerFrame.file,
        lineNumber: source?.lineNumber ?? ownerFrame.line,
        columnNumber: source?.columnNumber ?? ownerFrame.col,
        functionName: ownerFrame.function,
      };
    }),
  );

  return mappedEntries;
};
