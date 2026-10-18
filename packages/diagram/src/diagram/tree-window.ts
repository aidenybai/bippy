import type { VirtualRange } from "./tree-model";

export const getTreeWindow = (
  offsets: readonly number[],
  scrollTop: number,
  height: number,
  overscan = 5,
): VirtualRange => {
  const count = Math.max(0, offsets.length - 1);
  const getIndex = (position: number) => {
    let start = 0;
    let end = count;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (offsets[middle + 1] <= position) start = middle + 1;
      else end = middle;
    }
    return start;
  };
  const first = getIndex(Math.max(0, scrollTop));
  const endPosition = Math.max(0, scrollTop) + height;
  const lastIndex = getIndex(endPosition);
  const last = Math.min(count, lastIndex + (offsets[lastIndex] < endPosition ? 1 : 0));
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + overscan),
    offset: offsets[Math.max(0, first - overscan)] ?? 0,
    firstVisible: first,
    lastVisible: last,
    totalHeight: offsets[count] ?? 0,
  };
};
