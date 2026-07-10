import { Fiber } from "../types.js";

import { FiberSource } from "./types.js";
import {
  SCHEME_REGEX,
  INTERNAL_SCHEME_PREFIXES,
  ABOUT_REACT_PREFIX,
  ANONYMOUS_FILE_PATTERNS,
  SOURCE_FILE_EXTENSION_REGEX,
  BUNDLED_FILE_PATTERN_REGEX,
  QUERY_PARAMETER_PATTERN_REGEX,
} from "./constants.js";
import { getDefinitionFrameFromOwnedChild, getParentStack, hasDebugStack } from "./owner-stack.js";
import { parseDebugStack } from "./parse-debug-stack.js";
import { StackFrame } from "./parse-stack.js";
import { symbolicateStack } from "./symbolication.js";

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
    debugSource !== null &&
    "fileName" in debugSource &&
    typeof debugSource.fileName === "string" &&
    "lineNumber" in debugSource &&
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
  cache = true,
  fetchFn?: (url: string) => Promise<Response>,
): Promise<FiberSource | null> => {
  if (hasDebugSource(fiber)) {
    const debugSource = fiber._debugSource;
    return debugSource || null;
  }

  const debugStackFrame =
    getUsageFrameFromDebugStack(fiber) ?? getDefinitionFrameFromOwnedChild(fiber);
  if (debugStackFrame) {
    const [symbolicatedFrame] = await symbolicateStack([debugStackFrame], cache, fetchFn);
    const debugStackSource = toFiberSource(symbolicatedFrame);
    if (debugStackSource) {
      return debugStackSource;
    }
  }

  const componentStack = await getParentStack(fiber, cache, fetchFn);
  for (const stackFrame of componentStack) {
    if (stackFrame.fileName) {
      return toFiberSource(stackFrame);
    }
  }
  return null;
};

const getPathSegmentCount = (path: string): number => path.split("/").filter(Boolean).length;

const getFirstPathSegment = (path: string): string | null => {
  const segments = path.split("/").filter(Boolean);
  return segments[0] ?? null;
};

const stripSingleBasePathPrefix = (path: string): string => {
  const firstSlashIndex = path.indexOf("/", 1);
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

  if (firstRemainderSegment.startsWith("@")) {
    return path;
  }

  if (firstRemainderSegment.length > 4) {
    return path;
  }

  return remainderPath;
};

export const normalizeFileName = (fileName: string): string => {
  if (!fileName) {
    return "";
  }

  if (ANONYMOUS_FILE_PATTERNS.some((pattern) => pattern === fileName)) {
    return "";
  }

  let normalizedFileName = fileName;

  const isHttpUrl =
    normalizedFileName.startsWith("http://") || normalizedFileName.startsWith("https://");
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
    const slashIndex = remainder.indexOf("/");
    const colonIndex = remainder.indexOf(":");

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

        if (prefix === "file:///") {
          normalizedFileName = `/${normalizedFileName.replace(/^\/+/, "")}`;
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

  if (normalizedFileName.startsWith("//")) {
    const firstPathSlashIndex = normalizedFileName.indexOf("/", 2);
    normalizedFileName =
      firstPathSlashIndex === -1 ? "" : normalizedFileName.slice(firstPathSlashIndex);
  }

  const queryParameterIndex = normalizedFileName.indexOf("?");
  if (queryParameterIndex !== -1) {
    const potentialQueryParameters = normalizedFileName.slice(queryParameterIndex);
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
