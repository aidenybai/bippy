import type { Span } from "oxc-parser";
import type { ParsedSourceFile, SourceLocation } from "../types.js";

const findLineIndex = (lineStarts: number[], offset: number): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
};

export const getSourceLocation = (file: ParsedSourceFile, span: Span): SourceLocation => {
  const lineIndex = findLineIndex(file.lineStarts, span.start);
  return {
    filePath: file.filePath,
    line: lineIndex + 1,
    column: span.start - file.lineStarts[lineIndex] + 1,
  };
};

export const formatSourceLocation = (location: SourceLocation | null): string =>
  location ? `${location.filePath}:${location.line}:${location.column}` : "<unknown>";
