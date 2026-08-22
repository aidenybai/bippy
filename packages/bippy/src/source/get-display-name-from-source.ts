import type { Fiber } from "../react-internals/index.js";
import { getDisplayName } from "../core.js";
import { getDefinitionFrameFromOwnedChild, getRawParentStack } from "./owner-stack.js";
import {
  getSourceContentFromSourceMap,
  getSourceFromSourceMap,
  getSourceMap,
  type SourceFetch,
  type SourceMapRequestOptions,
} from "./symbolication.js";
import type { StackFrame } from "./parse-stack.js";

const COMPONENT_DECLARATION_PATTERNS = [
  /(?:^|export\s+)(?:const|let|var)\s+(\w+)\s*=/,
  /(?:^|export\s+)function\s+(\w+)/,
  /(?:^|export\s+)class\s+(\w+)/,
];

const findComponentDeclarationOnLine = (line: string): string | null => {
  for (const pattern of COMPONENT_DECLARATION_PATTERNS) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const MAX_DECLARATION_LINE_DISTANCE = 5;

const extractComponentNameFromSource = (
  sourceContent: string,
  lineNumber: number,
): string | null => {
  const lines = sourceContent.split("\n");
  const targetLineIndex = lineNumber - 1;

  if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
    return null;
  }

  for (let lineDistance = 0; lineDistance <= MAX_DECLARATION_LINE_DISTANCE; lineDistance++) {
    const lineIndexes =
      lineDistance === 0
        ? [targetLineIndex]
        : [targetLineIndex - lineDistance, targetLineIndex + lineDistance];
    for (const lineIndex of lineIndexes) {
      if (lineIndex < 0 || lineIndex >= lines.length) continue;
      const declarationName = findComponentDeclarationOnLine(lines[lineIndex]);
      if (declarationName) return declarationName;
    }
  }

  return null;
};

export const getDisplayNameFromSource = async (
  fiber: Fiber,
  shouldUseCache = true,
  sourceFetch?: SourceFetch,
  requestOptions: SourceMapRequestOptions = {},
): Promise<string | null> => {
  const stackFrame =
    getDefinitionFrameFromOwnedChild(fiber) ??
    getRawParentStack(fiber).find((innerFrame) => innerFrame.fileName);

  if (!stackFrame?.fileName) {
    return getDisplayName(fiber.type);
  }

  const bundleSourceMap = await getSourceMap(
    stackFrame.fileName,
    shouldUseCache,
    sourceFetch,
    requestOptions,
  );

  if (!bundleSourceMap) {
    return getDisplayName(fiber.type);
  }

  let source: StackFrame | null = null;

  if (typeof stackFrame.lineNumber === "number" && typeof stackFrame.columnNumber === "number") {
    source = getSourceFromSourceMap(
      bundleSourceMap,
      stackFrame.lineNumber,
      stackFrame.columnNumber,
    );
  }

  if (!source?.fileName || !source.lineNumber) {
    return getDisplayName(fiber.type);
  }

  const sourceContent = getSourceContentFromSourceMap(bundleSourceMap, source.fileName);
  const extractedName = sourceContent
    ? extractComponentNameFromSource(sourceContent, source.lineNumber)
    : null;

  if (extractedName) {
    return extractedName;
  }

  return source.functionName ?? getDisplayName(fiber.type);
};
