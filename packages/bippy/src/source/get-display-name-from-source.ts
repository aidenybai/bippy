import { Fiber } from '../types.js';
import { getDisplayName } from '../core.js';
import { getComponentStack } from './get-source.js';
import { getSourceFromSourceMap, getSourceMap } from './symbolication.js';
import { StackFrame } from './parse-stack.js';

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
  const ownerStack = await getComponentStack(fiber, cache, fetchFn);
  const stackFrame = ownerStack.filter((stackFrame) => stackFrame.fileName)[0];

  if (!stackFrame?.fileName) {
    return getDisplayName(fiber.type);
  }

  const bundleSourceMap = await getSourceMap(
    stackFrame.fileName,
    cache,
    fetchFn,
  );

  if (!bundleSourceMap) {
    return getDisplayName(fiber.type);
  }

  let source: StackFrame | null = null;

  if (
    typeof stackFrame.lineNumber === 'number' &&
    typeof stackFrame.columnNumber === 'number'
  ) {
    source = getSourceFromSourceMap(
      bundleSourceMap,
      stackFrame.lineNumber,
      stackFrame.columnNumber,
    );
  }

  if (!source?.fileName || !source.lineNumber) {
    return getDisplayName(fiber.type);
  }

  if (!bundleSourceMap.sourcesContent) {
    return getDisplayName(fiber.type);
  }

  const sourceIndex = bundleSourceMap.sources.indexOf(source.fileName);
  if (sourceIndex === -1 || !bundleSourceMap.sourcesContent[sourceIndex]) {
    return getDisplayName(fiber.type);
  }

  const sourceContent = bundleSourceMap.sourcesContent[sourceIndex];
  const extractedName = extractComponentNameFromSource(
    sourceContent,
    source.lineNumber,
  );

  if (extractedName) {
    return extractedName;
  }

  return getDisplayName(fiber.type);
};
