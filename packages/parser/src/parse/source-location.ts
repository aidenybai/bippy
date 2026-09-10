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

const locationsBySpan = new WeakMap<Span, SourceLocation>();

export const getSourceLocation = (file: ParsedSourceFile, span: Span): SourceLocation => {
  const cached = locationsBySpan.get(span);
  if (cached && cached.filePath === file.filePath) return cached;
  const lineIndex = findLineIndex(file.lineStarts, span.start);
  const location = {
    filePath: file.filePath,
    line: lineIndex + 1,
    column: span.start - file.lineStarts[lineIndex] + 1,
  };
  locationsBySpan.set(span, location);
  return location;
};

export const formatSourceLocation = (location: SourceLocation | null): string =>
  location ? `${location.filePath}:${location.line}:${location.column}` : "<unknown>";
