// Map byte offsets to source positions. Standalone `lineOf`/`lineColOf` scan from
// offset 0 (O(offset) per call); `createLineIndex` precomputes newline positions
// once so each lookup is a binary search — used on the hot per-decision/gap path.

export const lineColOf = (source: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  const limit = Math.min(offset, source.length);
  for (let index = 0; index < limit; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, column: limit - lineStart };
};

export const lineOf = (source: string, offset: number): number => lineColOf(source, offset).line;

export interface LineIndex {
  lineOf: (offset: number) => number;
  lineColOf: (offset: number) => { line: number; column: number };
}

export const createLineIndex = (source: string): LineIndex => {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  const lineIndexAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  return {
    lineOf: (offset) => lineIndexAt(offset) + 1,
    lineColOf: (offset) => {
      const clamped = Math.min(offset, source.length);
      const index = lineIndexAt(clamped);
      return { line: index + 1, column: clamped - lineStarts[index]! };
    },
  };
};
