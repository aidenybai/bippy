export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceLocation extends SourcePosition {
  filePath: string;
}

export interface LineIndex {
  getPosition: (offset: number) => SourcePosition;
}

/**
 * Builds a 1-based line / 1-based column lookup for byte offsets, matching
 * what React DevTools reports for `_debugSource` and what editors display.
 */
export const createLineIndex = (sourceText: string): LineIndex => {
  const lineStarts = [0];
  for (let index = 0; index < sourceText.length; index++) {
    if (sourceText.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  return {
    getPosition: (offset) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lineStarts[middle] <= offset) low = middle;
        else high = middle - 1;
      }
      return { line: low + 1, column: offset - lineStarts[low] + 1 };
    },
  };
};
