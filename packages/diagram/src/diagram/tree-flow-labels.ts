import {
  diagramMetrics,
  getCurvePoint,
  getLabelWidth,
  type EdgeGeometry,
  type Point,
} from "./geometry";

export interface TreeFlowLabel extends EdgeGeometry {
  id: string;
  label?: string;
}

export const getTreeFlowLabelPositions = (
  edges: readonly TreeFlowLabel[],
  positions: readonly Point[],
  width: number,
) => {
  const labels = new Map<string, Point>();
  const orderedEdges = edges
    .flatMap((edge) =>
      edge.label && edge.from.y !== edge.to.y ? [{ ...edge, label: edge.label }] : [],
    )
    .sort(
      (first, second) =>
        Math.abs(first.to.y - first.from.y) - Math.abs(second.to.y - second.from.y) ||
        first.id.localeCompare(second.id),
    );
  if (orderedEdges.length === 0) return labels;
  const gaps = positions
    .slice(1)
    .flatMap((position, index) =>
      position.y - positions[index].y >= diagramMetrics.fontSize * 2 + 4
        ? [(positions[index].y + position.y) / 2]
        : [],
    );
  const occupiedGaps = new Set<number>();
  for (const edge of orderedEdges) {
    const labelWidth = getLabelWidth({ label: edge.label, labelOffset: 0 });
    if (labelWidth + 8 > width) continue;
    const middle = (edge.from.y + edge.to.y) / 2;
    let selectedGap: number | undefined;
    for (const gap of gaps) {
      if (
        occupiedGaps.has(gap) ||
        gap < Math.min(edge.from.y, edge.to.y) ||
        gap > Math.max(edge.from.y, edge.to.y)
      )
        continue;
      if (selectedGap === undefined || Math.abs(gap - middle) < Math.abs(selectedGap - middle))
        selectedGap = gap;
    }
    if (selectedGap === undefined) continue;
    occupiedGaps.add(selectedGap);
    const verticalProgress = (selectedGap - edge.from.y) / (edge.to.y - edge.from.y);
    let lower = 0;
    let upper = 1;
    for (let iteration = 0; iteration < 16; iteration++) {
      const progress = (lower + upper) / 2;
      if (progress ** 2 * (3 - 2 * progress) < verticalProgress) lower = progress;
      else upper = progress;
    }
    const point = getCurvePoint(edge, (lower + upper) / 2);
    labels.set(edge.id, {
      x: Math.max(4, Math.min(width - labelWidth - 4, point.x + 4)),
      y: selectedGap + diagramMetrics.fontSize * 0.32,
    });
  }
  return labels;
};
