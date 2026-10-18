import { diagramMetrics, getLabelWidth, type Point } from "./geometry";
import type { DataflowEdge, DataflowNode } from "./dataflow-model";

interface DataflowOffsets {
  fromOffset: Point;
  toOffset: Point;
}

const getPortOffset = (node: DataflowNode, adjacent: Point, nodeGap = 0): Point => {
  const horizontalDistance = adjacent.x - node.x;
  const verticalDistance = adjacent.y - node.y;
  if (verticalDistance === 0 && horizontalDistance > 0) return { x: getLabelWidth(node) + 4, y: 0 };
  const distance = Math.hypot(horizontalDistance, verticalDistance);
  if (distance === 0) return { x: 0, y: 0 };
  const strokeRadius = diagramMetrics.strokeWidth / 2;
  const shapeRadius =
    node.componentType === "class"
      ? ((diagramMetrics.nodeRadius + strokeRadius) * distance) /
        Math.max(Math.abs(horizontalDistance), Math.abs(verticalDistance))
      : node.componentType === "memo" || node.componentType === "forward-ref"
        ? ((diagramMetrics.nodeRadius + strokeRadius * Math.SQRT2) * distance) /
          (Math.abs(horizontalDistance) + Math.abs(verticalDistance))
        : diagramMetrics.nodeRadius + strokeRadius;
  const radius = shapeRadius + nodeGap;
  return { x: (horizontalDistance / distance) * radius, y: (verticalDistance / distance) * radius };
};

export const getDataflowOffsets = (
  edge: DataflowEdge,
  from: DataflowNode,
  to: DataflowNode,
): DataflowOffsets => {
  if (edge.shape === "curve") {
    const direction = edge.side === "right" ? 1 : -1;
    return {
      fromOffset: edge.fromOffset ?? getPortOffset(from, { x: from.x + direction, y: from.y }),
      toOffset:
        edge.toOffset ??
        getPortOffset(to, { x: to.x + direction, y: to.y }, diagramMetrics.arrowGap),
    };
  }
  const middleX = (from.x + to.x) / 2;
  const waypoints =
    edge.waypoints ??
    (edge.kind === "context"
      ? [{ x: from.x, y: to.y }]
      : [
          { x: middleX, y: from.y },
          { x: middleX, y: to.y },
        ]);
  const firstPoint =
    [...waypoints, to].find((point) => point.x !== from.x || point.y !== from.y) ?? to;
  const lastPoint =
    [...waypoints]
      .reverse()
      .concat(from)
      .find((point) => point.x !== to.x || point.y !== to.y) ?? from;
  return {
    fromOffset: edge.fromOffset ?? getPortOffset(from, firstPoint),
    toOffset: edge.toOffset ?? getPortOffset(to, lastPoint, diagramMetrics.arrowGap),
  };
};
