import { getSolidColor } from "../lib/colors";
import type { Box } from "../lib/positions";
import type { GraphEdge } from "../model";
import { useViewer } from "./context";

const MIN_BOW = 16;

export interface PlacedArc {
  edge: GraphEdge;
  from: Box;
  to: Box;
}

const getAnchor = (box: Box, side: "top" | "bottom"): { x: number; y: number } => ({
  x: box.x + box.width / 2,
  y: side === "top" ? box.y : box.y + box.height,
});

const getArcPath = (from: Box, to: Box): string => {
  const isGoingDown = to.y > from.y;
  const start = getAnchor(from, isGoingDown ? "bottom" : "top");
  const end = getAnchor(to, isGoingDown ? "top" : "bottom");
  const bow = Math.max(MIN_BOW, Math.abs(end.y - start.y) / 2) * (isGoingDown ? 1 : -1);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bow}, ${end.x} ${end.y - bow}, ${end.x} ${end.y}`;
};

export const Arc = ({ edge, from, to }: PlacedArc) => {
  const { causalNodeIds, colorByNodeId, isInactiveNode } = useViewer();
  const color = colorByNodeId.get(edge.to) ?? colorByNodeId.get(edge.from) ?? "rgba(0, 0, 0, 0.3)";
  const isActive =
    causalNodeIds !== null && causalNodeIds.has(edge.from) && causalNodeIds.has(edge.to);
  const isMuted = (causalNodeIds !== null && !isActive) || isInactiveNode(edge.from);
  return (
    <path
      d={getArcPath(from, to)}
      fill="none"
      stroke={getSolidColor(color)}
      strokeWidth={isActive ? 1.75 : 1}
      strokeDasharray={edge.kind === "writes" ? "4 3" : undefined}
      opacity={isMuted ? 0.1 : isActive ? 1 : 0.55}
      markerEnd="url(#arc-head)"
    />
  );
};

export const ArcHead = () => (
  <defs>
    <marker
      id="arc-head"
      viewBox="0 0 10 10"
      refX="10"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
    </marker>
  </defs>
);
