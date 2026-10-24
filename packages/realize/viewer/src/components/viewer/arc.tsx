import { getSolidColor } from "@/lib/colors";
import type { Box } from "@/lib/positions";
import type { GraphEdge } from "@/model";
import { useHasHover, useIsCausalEdge, useIsInactive } from "@/store/hover";

const SIDE_GAP = 24;
const SIDE_REACH = 160;
const MIN_BOW = 10;
const SIDE_BULGE = 28;
const STEM = 8;
const MAX_BOW = 60;
const LANE_SWING = 14;

export interface PlacedArc {
  edge: GraphEdge;
  from: Box;
  to: Box;
  fromSlot: number;
  toSlot: number;
  lane: number;
  color: string;
}

interface Point {
  x: number;
  y: number;
}

const getSlotX = (box: Box, slot: number): number => box.x + box.width * slot;

const getLaneSwing = (lane: number): number =>
  lane === 0 ? 0 : (lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2) * LANE_SWING;

const getSidePath = ({ from, to, lane }: PlacedArc): string => {
  const start: Point = { x: from.x + from.width + 2, y: from.y + from.height / 2 };
  const tip: Point = { x: to.x + to.width + 6, y: to.y + to.height / 2 };
  const base: Point = { x: tip.x + STEM, y: tip.y };
  const bulge = Math.max(start.x, base.x) + SIDE_BULGE + lane * LANE_SWING;
  return `M ${start.x} ${start.y} C ${bulge} ${start.y}, ${bulge} ${base.y}, ${base.x} ${base.y} L ${tip.x} ${tip.y}`;
};

const getVerticalPath = (arc: PlacedArc): string => {
  const direction = arc.to.y > arc.from.y ? 1 : -1;
  const start: Point = {
    x: getSlotX(arc.from, arc.fromSlot),
    y: direction === 1 ? arc.from.y + arc.from.height : arc.from.y,
  };
  const tip: Point = {
    x: getSlotX(arc.to, arc.toSlot),
    y: direction === 1 ? arc.to.y : arc.to.y + arc.to.height,
  };
  const base: Point = { x: tip.x, y: tip.y - STEM * direction };
  const bow = Math.max(MIN_BOW, Math.min(MAX_BOW, Math.abs(base.y - start.y) / 2)) * direction;
  const swing = getLaneSwing(arc.lane);
  return `M ${start.x} ${start.y} C ${start.x + swing} ${start.y + bow}, ${base.x + swing} ${base.y - bow}, ${base.x} ${base.y} L ${tip.x} ${tip.y}`;
};

const getArcPath = (arc: PlacedArc): string => {
  const gap =
    arc.to.y > arc.from.y
      ? arc.to.y - (arc.from.y + arc.from.height)
      : arc.from.y - (arc.to.y + arc.to.height);
  const reach = Math.abs(arc.from.x + arc.from.width / 2 - (arc.to.x + arc.to.width / 2));
  return gap < SIDE_GAP && reach < SIDE_REACH ? getSidePath(arc) : getVerticalPath(arc);
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
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
    </marker>
  </defs>
);
