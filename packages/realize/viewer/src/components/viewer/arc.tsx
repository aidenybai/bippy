import { isSideArc, type PlacedArc, type Point } from "@/lib/arcs";
import { getSolidColor } from "@/lib/colors";
import type { Box } from "@/lib/positions";
import type { GraphEdge } from "@/model";
import { useHasHover, useIsCausalEdge, useIsInactive } from "@/store/viewer";

const MIN_BOW = 10;
const SIDE_BULGE = 28;
const STEM = 8;
const MAX_BOW = 60;
const LANE_SWING = 22;

const EVENT_ARC_KINDS = new Set<GraphEdge["kind"]>(["triggers", "writes"]);

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

const getBow = (from: Point, to: Point, direction: number): number =>
  Math.max(MIN_BOW, Math.min(MAX_BOW, Math.abs(to.y - from.y) / 2)) * direction;

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
  const trunk = arc.junction ?? start;
  const feederBow = getBow(start, trunk, direction);
  const feeder = arc.junction
    ? `C ${start.x} ${start.y + feederBow}, ${trunk.x} ${trunk.y - feederBow}, ${trunk.x} ${trunk.y}`
    : "";
  const bow = getBow(trunk, base, direction);
  const swing = getLaneSwing(arc.lane);
  return `M ${start.x} ${start.y} ${feeder} C ${trunk.x + swing} ${trunk.y + bow}, ${base.x + swing} ${base.y - bow}, ${base.x} ${base.y} L ${tip.x} ${tip.y}`;
};

interface ArcProps extends PlacedArc {
  markerId: string;
}

export const Arc = ({ markerId, ...arc }: ArcProps) => {
  const isActive = useIsCausalEdge(arc.edge.from, arc.edge.to);
  const hasHover = useHasHover();
  const isInactive = useIsInactive(arc.component);
  const isMuted = (hasHover && !isActive) || isInactive;
  const isEvent = EVENT_ARC_KINDS.has(arc.edge.kind);
  return (
    <path
      d={isSideArc(arc) ? getSidePath(arc) : getVerticalPath(arc)}
      fill="none"
      stroke={getSolidColor(arc.color)}
      strokeWidth={isActive ? 1.75 : 1}
      strokeDasharray={isEvent ? "4 3" : undefined}
      markerEnd={`url(#${markerId}${isEvent ? "hollow" : "solid"})`}
      opacity={isMuted ? 0.1 : isActive ? 1 : 0.55}
    />
  );
};
