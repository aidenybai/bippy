import { JSX_FACTORY_FRAME_COUNT, REACT_STACK_BOTTOM_FRAME_PATTERNS } from "./constants.js";
import { parseStack, StackFrame } from "./parse-stack.js";

interface V8CallSite {
  getFunctionName?: () => string | null;
  getScriptNameOrSourceURL?: () => string | null;
  getLineNumber?: () => number | null;
  getColumnNumber?: () => number | null;
  getEnclosingLineNumber?: () => number | null;
  getEnclosingColumnNumber?: () => number | null;
  getTypeName?: () => string | null;
  getMethodName?: () => string | null;
  getEvalOrigin?: () => string | null;
  isNative?: () => boolean;
  isEval?: () => boolean;
  toString: () => string;
}

export interface ParsedDebugStack {
  frames: StackFrame[];
  // React appends a react-stack-bottom-frame sentinel to stacks captured
  // during render; without it the JSX was created outside a render and the
  // lower frames are arbitrary bootstrapping code
  isTrusted: boolean;
}

const parsedDebugStackCache = new WeakMap<Error, ParsedDebugStack>();

const isReactBottomFrameName = (functionName: string): boolean =>
  REACT_STACK_BOTTOM_FRAME_PATTERNS.some((pattern) => functionName.includes(pattern));

const getCallSiteFunctionName = (callSite: V8CallSite): string => {
  const functionName = callSite.getFunctionName?.() ?? "";
  if (functionName) {
    return functionName;
  }
  const typeName = callSite.getTypeName?.() ?? "";
  const methodName = callSite.getMethodName?.() ?? "";
  if (typeName && methodName) {
    return `${typeName}.${methodName}`;
  }
  return methodName;
};

const collectStructuredFrames = (callSites: V8CallSite[]): ParsedDebugStack => {
  const frames: StackFrame[] = [];
  for (
    let callSiteIndex = JSX_FACTORY_FRAME_COUNT;
    callSiteIndex < callSites.length;
    callSiteIndex++
  ) {
    const callSite = callSites[callSiteIndex];
    const functionName = getCallSiteFunctionName(callSite);
    if (isReactBottomFrameName(functionName)) {
      return { frames, isTrusted: true };
    }
    if (callSite.isNative?.()) {
      frames.push({ functionName: functionName || undefined });
      continue;
    }
    let fileName = callSite.getScriptNameOrSourceURL?.() ?? "";
    if (!fileName && callSite.isEval?.()) {
      fileName = callSite.getEvalOrigin?.() ?? "";
    }
    frames.push({
      functionName: functionName && functionName !== "<anonymous>" ? functionName : undefined,
      fileName: fileName && fileName !== "<anonymous>" ? fileName : undefined,
      lineNumber: callSite.getLineNumber?.() ?? undefined,
      columnNumber: callSite.getColumnNumber?.() ?? undefined,
      enclosingLineNumber: callSite.getEnclosingLineNumber?.() ?? undefined,
      enclosingColumnNumber: callSite.getEnclosingColumnNumber?.() ?? undefined,
      source: `    at ${callSite.toString()}`,
    });
  }
  return { frames, isTrusted: false };
};

const parseMaterializedStack = (stackString: string): ParsedDebugStack => {
  let bottomFrameIndex = -1;
  for (const pattern of REACT_STACK_BOTTOM_FRAME_PATTERNS) {
    bottomFrameIndex = stackString.indexOf(pattern);
    if (bottomFrameIndex !== -1) break;
  }
  const trimmedStack =
    bottomFrameIndex === -1
      ? stackString
      : stackString.slice(0, stackString.lastIndexOf("\n", bottomFrameIndex));
  return {
    frames: parseStack(trimmedStack).slice(JSX_FACTORY_FRAME_COUNT),
    isTrusted: bottomFrameIndex !== -1,
  };
};

/**
 * Parses a React `_debugStack` Error, preferring V8's structured CallSite API
 * (via Error.prepareStackTrace) over string parsing. Structured frames carry
 * enclosing line/column - the function definition start, not the call site -
 * and are immune to source-mapped `.stack` strings. Falls back to string
 * parsing on engines without CallSites (JSC, SpiderMonkey) or when the stack
 * was already materialized. The leading JSX factory frame (jsxDEV) and
 * everything at or below React's bottom-frame sentinel are dropped.
 */
export const parseDebugStack = (debugStack: Error): ParsedDebugStack => {
  const cachedResult = parsedDebugStackCache.get(debugStack);
  if (cachedResult) {
    return cachedResult;
  }

  let structuredResult: ParsedDebugStack | null = null;
  const collectFramesAndFormatStack = (error: Error, callSites: V8CallSite[]): string => {
    structuredResult = collectStructuredFrames(callSites);
    // this return value becomes error.stack permanently, so emit the default
    // V8 format for any later reader of the same error
    let stackString = `${error.name || "Error"}: ${error.message || ""}`;
    for (const callSite of callSites) {
      stackString += `\n    at ${callSite.toString()}`;
    }
    return stackString;
  };
  const previousPrepareStackTrace = Error.prepareStackTrace;
  // node's CallSite typings disagree with browser-safe optional methods
  Error.prepareStackTrace = collectFramesAndFormatStack as typeof Error.prepareStackTrace;
  let stackString: string;
  try {
    stackString = String(debugStack.stack);
  } finally {
    Error.prepareStackTrace = previousPrepareStackTrace;
  }

  const result = structuredResult ?? parseMaterializedStack(stackString);
  parsedDebugStackCache.set(debugStack, result);
  return result;
};
