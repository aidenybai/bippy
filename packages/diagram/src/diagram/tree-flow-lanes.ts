import type { DataflowEdge } from "./dataflow-model";

export const getTreeFlowLanes = (
  edges: readonly DataflowEdge[],
  indexById: ReadonlyMap<string, number>,
) => {
  const intervals = edges
    .flatMap((edge) => {
      const fromIndex = indexById.get(edge.from);
      const toIndex = indexById.get(edge.to);
      return fromIndex === undefined || toIndex === undefined
        ? []
        : [{ id: edge.id, start: Math.min(fromIndex, toIndex), end: Math.max(fromIndex, toIndex) }];
    })
    .sort(
      (first, second) =>
        first.start - second.start || first.end - second.end || first.id.localeCompare(second.id),
    );
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const interval of intervals) {
    const freeLane = ends.findIndex((end) => end < interval.start);
    const lane = freeLane < 0 ? ends.length : freeLane;
    ends[lane] = interval.end;
    lanes.set(interval.id, lane);
  }
  return { lanes, count: ends.length };
};
