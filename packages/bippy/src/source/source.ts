import { parseStack } from 'error-stack-parser-es/lite';

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
  const useCache = options?.cache ?? true;
  if (hasDebugSource(fiber)) {
    const source = fiber._debugSource;
    return source || null;
  }

  const fallbackOwnerStack = hasDebugStack(fiber)
    ? formatOwnerStack(fiber._debugStack.stack)
    : getFallbackOwnerStack(fiber);
  const stackFrames = parseStack(fallbackOwnerStack, { slice: 1 });
  const stackFrame = stackFrames[0];
  if (!stackFrame?.file) {
    return null;
  }
  const sourceMap = await getCachedSourceMap(stackFrame.file, useCache);
  if (!sourceMap || !stackFrame.line || !stackFrame.col) {
    return null;
  }
  const source = lookupSourceFromSourceMap(
    sourceMap,
    stackFrame.line,
    stackFrame.col,
  );
  return source;
};
