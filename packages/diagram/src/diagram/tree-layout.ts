import { diagramMetrics, type Point } from "./geometry";
import type { TreeRow } from "./tree-model";

export interface TreeLayout {
  positions: readonly Point[];
  offsets: readonly number[];
}

export const getTreeLayout = (
  rows: readonly TreeRow[],
  rowHeight = diagramMetrics.rowHeight,
  indent = diagramMetrics.indent,
): TreeLayout => {
  const positions: Point[] = [];
  const offsets = [0];
  for (const [index, row] of rows.entries()) {
    const isDetail = row.node.componentId !== undefined;
    const height = isDetail ? Math.min(rowHeight, diagramMetrics.detailRowHeight) : rowHeight;
    const parent = positions[row.parentIndex];
    positions.push({
      x:
        isDetail && parent
          ? parent.x + diagramMetrics.labelOffset
          : diagramMetrics.indent * 2 + row.depth * indent,
      y: offsets[index] + height / 2,
    });
    offsets.push(offsets[index] + height);
  }
  return { positions, offsets };
};
