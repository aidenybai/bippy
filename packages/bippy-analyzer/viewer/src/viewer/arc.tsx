import { getSolidColor } from "../lib/colors";
import type { Box } from "../lib/positions";
import type { GraphEdge } from "../model";
import { useHasHover, useIsCausalEdge, useIsInactive } from "../store/hover";

const SIDE_GAP = 12;
const SIDE_BULGE = 28;
const MAX_BOW = 60;

export interface PlacedArc {
  edge: GraphEdge;
  from: Box;
  to: Box;
  fromSlot: number;
  toSlot: number;
  color: string;
}

interface Point {
  x: number;
  y: number;
}

const getSlotX = (box: Box, slot: number): number => box.x + box.width * slot;

const getSidePath = (from: Box, to: Box): string => {
  const start: Point = { x: from.x + from.width + 2, y: from.y + from.height / 2 };
  const end: Point = { x: to.x + to.width + 8, y: to.y + to.height / 2 };
  const bulge = Math.max(start.x, end.x) + SIDE_BULGE;
  return `M ${start.x} ${start.y} C ${bulge} ${start.y}, ${bulge} ${end.y}, ${end.x} ${end.y}`;
};

const getVerticalPath = (arc: PlacedArc): string => {
  const isGoingDown = arc.to.y > arc.from.y;
  const start: Point = {
    x: getSlotX(arc.from, arc.fromSlot),
    y: isGoingDown ? arc.from.y + arc.from.height : arc.from.y,
  };
  const end: Point = {
    x: getSlotX(arc.to, arc.toSlot),
    y: isGoingDown ? arc.to.y : arc.to.y + arc.to.height,
  };
  const bow = Math.min(MAX_BOW, Math.abs(end.y - start.y) / 2) * (isGoingDown ? 1 : -1);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bow}, ${end.x} ${end.y - bow}, ${end.x} ${end.y}`;
};

const getArcPath = (arc: PlacedArc): string => {
  const gap =
    arc.to.y > arc.from.y
      ? arc.to.y - (arc.from.y + arc.from.height)
      : arc.from.y - (arc.to.y + arc.to.height);
  return gap < SIDE_GAP ? getSidePath(arc.from, arc.to) : getVerticalPath(arc);
};

export const Arc = (arc: PlacedArc) => {
  const isActive = useIsCausalEdge(arc.edge.from, arc.edge.to);
  const hasHover = useHasHover();
  const isInactive = useIsInactive(arc.edge.from);
  const isMuted = (hasHover && !isActive) || isInactive;
  return (
    <path
      d={getArcPath(arc)}
      fill="none"
      stroke={getSolidColor(arc.color)}
      strokeWidth={isActive ? 1.75 : 1}
      strokeDasharray={arc.edge.kind === "writes" ? "4 3" : undefined}
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
