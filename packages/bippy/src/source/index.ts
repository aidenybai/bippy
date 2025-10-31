import { parseStack } from 'error-stack-parser-es/lite';

import { Fiber } from '../types.js';
import { formatOwnerStack, getFallbackOwnerStack } from './component-stack.js';
import { getOriginalPositionFor, getSourceMap } from './symbolication.js';

export { getFallbackOwnerStack as getOwnerStack } from './component-stack.js';
export { getOriginalPositionFor, getSourceMap } from './symbolication.js';

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

export interface FiberSource {
  columnNumber?: number;
  fileName: string;
  lineNumber?: number;
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
export const getSource = async (fiber: Fiber): Promise<FiberSource | null> => {
  if (hasDebugSource(fiber)) {
    const source = fiber._debugSource;
    return source || null;
  }
  if (hasDebugStack(fiber)) {
    const stack = formatOwnerStack(fiber._debugStack.stack);
    const stackFrames = parseStack(stack, { slice: 1 });
    const stackFrame = stackFrames[0];
    if (!stackFrame?.file) {
      return null;
    }
    const sourceMap = await getSourceMap(stackFrame.file);
    if (!sourceMap || !stackFrame.line || !stackFrame.col) {
      return null;
    }
    const originalPosition = getOriginalPositionFor(
      sourceMap,
      stackFrame.line,
      stackFrame.col,
    );
    if (
      !originalPosition.source ||
      !originalPosition.column ||
      !originalPosition.line
    ) {
      return null;
    }
    return {
      columnNumber: originalPosition.column,
      fileName: originalPosition.source,
      lineNumber: originalPosition.line,
    };
  }
  const fallbackOwnerStack = getFallbackOwnerStack(fiber);
  const stackFrames = parseStack(fallbackOwnerStack, { slice: 1 });
  const stackFrame = stackFrames[0];
  if (!stackFrame?.file) {
    return null;
  }
  const sourceMap = await getSourceMap(stackFrame.file);
  if (!sourceMap || !stackFrame.line || !stackFrame.col) {
    return null;
  }
  const originalPosition = getOriginalPositionFor(
    sourceMap,
    stackFrame.line,
    stackFrame.col,
  );
  if (
    !originalPosition.source ||
    !originalPosition.column ||
    !originalPosition.line
  ) {
    return null;
  }
  return {
    columnNumber: originalPosition.column,
    fileName: originalPosition.source,
    lineNumber: originalPosition.line,
  };
};
