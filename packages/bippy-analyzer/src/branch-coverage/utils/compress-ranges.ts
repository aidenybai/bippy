/** Collapse sorted line numbers into istanbul-style ranges: `[5,6,7,13] -> "5-7,13"`. */
export const compressRanges = (lineNumbers: number[]): string => {
  const sorted = [...new Set(lineNumbers)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;

  const flush = () => {
    if (rangeStart === null) return;
    ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
  };

  for (const lineNumber of sorted) {
    if (rangeStart === null) {
      rangeStart = rangeEnd = lineNumber;
    } else if (lineNumber === (rangeEnd ?? 0) + 1) {
      rangeEnd = lineNumber;
    } else {
      flush();
      rangeStart = rangeEnd = lineNumber;
    }
  }
  flush();

  return ranges.join(",");
};
