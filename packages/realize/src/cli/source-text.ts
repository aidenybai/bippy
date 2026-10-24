import { readFileSync } from "node:fs";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../core/types";

export interface SourceReader {
  read(file: string, loc: SourceLocation): string | null;
  readLineBefore(file: string, loc: SourceLocation): string | null;
}

interface SourceFile {
  text: string;
  lineStarts: number[];
}

interface SourcePosition {
  line: number;
  column: number;
  index: number;
}

const getLineStarts = (text: string): number[] => {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === "\n") lineStarts.push(index + 1);
  return lineStarts;
};

const loadSourceFile = (file: string): SourceFile | null => {
  try {
    const text = readFileSync(file, "utf8");
    return { text, lineStarts: getLineStarts(text) };
  } catch {
    return null;
  }
};

const isPositionInFile = (source: SourceFile, position: SourcePosition): boolean =>
  position.index <= source.text.length &&
  source.lineStarts[position.line - 1] === position.index - position.column;

export const createSourceReader = (): SourceReader => {
  const sourceFiles = new Map<string, SourceFile | null>();
  const locate = (file: string, loc: SourceLocation): SourceFile | null => {
    if (loc === GeneratedSource) return null;
    if (!sourceFiles.has(file)) sourceFiles.set(file, loadSourceFile(file));
    const source = sourceFiles.get(file);
    if (!source || !isPositionInFile(source, loc.start) || !isPositionInFile(source, loc.end))
      return null;
    return source;
  };
  return {
    read: (file, loc) => {
      const source = locate(file, loc);
      if (!source || loc === GeneratedSource) return null;
      return source.text.slice(loc.start.index, loc.end.index).replace(/\s+/g, " ");
    },
    readLineBefore: (file, loc) => {
      const source = locate(file, loc);
      if (!source || loc === GeneratedSource) return null;
      return source.text.slice(loc.start.index - loc.start.column, loc.start.index);
    },
  };
};
