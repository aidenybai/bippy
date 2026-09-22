import type { Fiber } from "../react-internals/index.js";
import { getDisplayName } from "../core.js";

import type { FiberSource } from "./types.js";
import { getDefinitionFrameFromOwnedChild, getParentStack, hasDebugStack } from "./owner-stack.js";
import { parseDebugStack } from "./parse-debug-stack.js";
import { parseStack, type StackFrame } from "./parse-stack.js";
import {
  getSourceFromSourceMapByFunctionName,
  getSourceMap,
  symbolicateStack,
  type SourceFetch,
  type SourceMapRequestOptions,
} from "./symbolication.js";

export const hasDebugSource = (
  fiber: Fiber,
): fiber is Fiber & {
  _debugSource: NonNullable<Fiber["_debugSource"]>;
} => {
  const debugSource = fiber._debugSource;
  if (!debugSource) {
    return false;
  }
  return (
    typeof debugSource === "object" &&
    typeof debugSource.fileName === "string" &&
    debugSource.fileName !== "(native)" &&
    typeof debugSource.lineNumber === "number"
  );
};

const toFiberSource = (stackFrame: StackFrame): FiberSource | null =>
  stackFrame.fileName
    ? {
        fileName: stackFrame.fileName,
        lineNumber: stackFrame.lineNumber,
        columnNumber: stackFrame.columnNumber,
        functionName: stackFrame.functionName,
      }
    : null;

// the fiber's own _debugStack (react 19) is captured at its JSX creation
// site, so its first user-space frame IS the usage site - no need to
// re-invoke the component like the throwing trick does
const getUsageFrameFromDebugStack = (fiber: Fiber): StackFrame | null => {
  if (!hasDebugStack(fiber)) {
    return null;
  }
  const { frames, isTrusted } = parseDebugStack(fiber._debugStack);
  if (!isTrusted) {
    return null;
  }
  for (const stackFrame of frames) {
    if (stackFrame.fileName) {
      return stackFrame;
    }
  }
  return null;
};

export const getRawSource = (fiber: Fiber): FiberSource | null => {
  if (hasDebugSource(fiber)) return fiber._debugSource;
  const stackFrame = getUsageFrameFromDebugStack(fiber) ?? getDefinitionFrameFromOwnedChild(fiber);
  return stackFrame ? toFiberSource(stackFrame) : null;
};

const getSourceByComponentName = async (
  fiber: Fiber,
  shouldUseCache: boolean,
  sourceFetch: SourceFetch | undefined,
  requestOptions: SourceMapRequestOptions,
): Promise<FiberSource | null> => {
  const functionName = getDisplayName(fiber.type);
  if (!functionName) return null;

  const runtimeStackFrames = parseStack(new Error().stack ?? "");
  const visitedFileNames = new Set<string>();
  for (const stackFrame of runtimeStackFrames) {
    const fileName = stackFrame.fileName;
    if (!fileName || visitedFileNames.has(fileName)) {
      continue;
    }
    visitedFileNames.add(fileName);
    const sourceMap = await getSourceMap(fileName, shouldUseCache, sourceFetch, requestOptions);
    if (!sourceMap) continue;
    const source = getSourceFromSourceMapByFunctionName(sourceMap, functionName);
    if (source && !source.isIgnoreListed) return toFiberSource(source);
  }
  return null;
};

/**
 * Returns the source of where the component is used. Available only in dev, for composite {@link Fiber}s.
 *
 * Resolution order:
 * 1. `_debugSource` (react <19, requires the JSX source babel transform)
 * 2. the fiber's own `_debugStack` (react 19) - the exact JSX creation site
 * 3. an owned child's `_debugStack` bottom frame (react 19) - a location
 *    inside the component's own body; works for components that the throwing
 *    trick cannot locate (no hooks, no props access)
 * 4. the legacy owner-stack path (throwing trick re-invocation)
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
  shouldUseCache = true,
  sourceFetch?: SourceFetch,
  requestOptions: SourceMapRequestOptions = {},
): Promise<FiberSource | null> => {
  if (hasDebugSource(fiber)) return fiber._debugSource;
  const rawSource = getRawSource(fiber);
  if (rawSource) {
    const [symbolicatedFrame] = await symbolicateStack(
      [
        {
          columnNumber: rawSource.columnNumber,
          fileName: rawSource.fileName,
          functionName: rawSource.functionName,
          lineNumber: rawSource.lineNumber,
        },
      ],
      shouldUseCache,
      sourceFetch,
      requestOptions,
    );
    const symbolicatedSource = toFiberSource(symbolicatedFrame);
    if (symbolicatedSource) return symbolicatedSource;
  }

  const parentStackFrames = await getParentStack(
    fiber,
    shouldUseCache,
    sourceFetch,
    requestOptions,
  );
  for (const stackFrame of parentStackFrames) {
    if (stackFrame.fileName) {
      return toFiberSource(stackFrame);
    }
  }
  return getSourceByComponentName(fiber, shouldUseCache, sourceFetch, requestOptions);
};

export { isSourceFile, normalizeFileName } from "./normalize-file-name.js";
