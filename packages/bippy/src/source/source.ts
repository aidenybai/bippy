import { parseStack } from './parse-stack.js';

import { Fiber } from '../types.js';
import { getDisplayName } from '../core.js';
import { formatOwnerStack, getFallbackOwnerStack } from './component-stack.js';
import {
  getSourceMap,
  lookupSourceFromSourceMap,
  type SourceMap,
} from './symbolication.js';
import { FiberSource } from './types.js';

const supportsWeakRef = typeof WeakRef !== 'undefined';

export const sourceMapCache = new Map<
  string,
  null | SourceMap | WeakRef<SourceMap>
>();
const pendingSourceMapFetches = new Map<
  string,
  null | Promise<null | SourceMap>
>();

const getCachedSourceMap = async (
  file: string,
  useCache = true,
  fetchFn?: (url: string) => Promise<Response>,
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

  const fetchPromise = getSourceMap(file, fetchFn);
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
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<FiberSource | null> => {
  if (hasDebugSource(fiber)) {
    const debugSource = fiber._debugSource;
    return debugSource || null;
  }

  const ownerStack = getOwnerStack(fiber);

  return getSourceFromStack(ownerStack, cache, fetchFn);
};

export const getOwnerStack = (fiber: Fiber) => {
  return hasDebugStack(fiber)
    ? formatOwnerStack(fiber._debugStack.stack)
    : getFallbackOwnerStack(fiber);
};

export const getSourceFromStack = async (
  ownerStack: string,
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
) => {
  const stackFrames = parseStack(ownerStack, { slice: 1 });
  const stackFrame = stackFrames[0];
  if (!stackFrame?.file) {
    return null;
  }
  const bundleSourceMap = await getCachedSourceMap(
    stackFrame.file,
    cache,
    fetchFn,
  );
  if (
    bundleSourceMap &&
    typeof stackFrame.line === 'number' &&
    typeof stackFrame.col === 'number'
  ) {
    const source = lookupSourceFromSourceMap(
      bundleSourceMap,
      stackFrame.line,
      stackFrame.col,
    );
    if (source) {
      return source;
    }
  }

  return {
    fileName: stackFrame.file,
    lineNumber: stackFrame.line,
    columnNumber: stackFrame.col,
  };
};

const extractComponentNameFromSource = (
  sourceContent: string,
  lineNumber: number,
): string | null => {
  const lines = sourceContent.split('\n');
  const targetLineIndex = lineNumber - 1;

  if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
    return null;
  }

  const startLine = Math.max(0, targetLineIndex - 5);
  const endLine = Math.min(lines.length, targetLineIndex + 5);
  const contextLines = lines.slice(startLine, endLine).join('\n');

  const arrowFunctionPattern = /(?:^|export\s+)(?:const|let|var)\s+(\w+)\s*=/m;
  const functionPattern = /(?:^|export\s+)function\s+(\w+)/m;
  const classPattern = /(?:^|export\s+)class\s+(\w+)/m;

  const arrowMatch = contextLines.match(arrowFunctionPattern);
  if (arrowMatch?.[1]) {
    return arrowMatch[1];
  }

  const functionMatch = contextLines.match(functionPattern);
  if (functionMatch?.[1]) {
    return functionMatch[1];
  }

  const classMatch = contextLines.match(classPattern);
  if (classMatch?.[1]) {
    return classMatch[1];
  }

  return null;
};

export const getDisplayNameFromSource = async (
  fiber: Fiber,
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<string | null> => {
  const source = await getSource(fiber, cache, fetchFn);

  if (!source?.fileName) {
    return getDisplayName(fiber.type);
  }

  const sourceMap = await getCachedSourceMap(source.fileName, cache, fetchFn);

  if (!sourceMap?.sourcesContent || !source.lineNumber) {
    return getDisplayName(fiber.type);
  }

  const sourceIndex = sourceMap.sources.indexOf(source.fileName);
  if (sourceIndex === -1 || !sourceMap.sourcesContent[sourceIndex]) {
    return getDisplayName(fiber.type);
  }

  const sourceContent = sourceMap.sourcesContent[sourceIndex];
  const extractedName = extractComponentNameFromSource(
    sourceContent,
    source.lineNumber,
  );

  if (extractedName) {
    return extractedName;
  }

  return getDisplayName(fiber.type);
};
