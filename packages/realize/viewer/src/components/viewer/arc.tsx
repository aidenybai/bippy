import { getSolidColor } from "@/lib/colors";
import type { Box } from "@/lib/positions";
import type { GraphEdge } from "@/model";
import { useHasHover, useIsCausalEdge, useIsInactive } from "@/store/hover";
import { ArrowHead, type Point } from "./arrow-head";

const SIDE_GAP = 24;
const SIDE_REACH = 160;
const MIN_BOW = 10;
const SIDE_BULGE = 28;
const STEM = 8;
const MAX_BOW = 60;
const LANE_SWING = 22;

const EVENT_ARC_KINDS = new Set<GraphEdge["kind"]>(["triggers", "writes"]);

export interface PlacedArc {
  edge: GraphEdge;
  from: Box;
  to: Box;
  fromSlot: number;
  toSlot: number;
  lane: number;
  junction: Point | null;
  color: string;
}

interface ArcShape {
  path: string;
  base: Point;
  tip: Point;
}

const getSlotX = (box: Box, slot: number): number => box.x + box.width * slot;

const getLaneSwing = (lane: number): number =>
  lane === 0 ? 0 : (lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2) * LANE_SWING;

const getSideShape = ({ from, to, lane }: PlacedArc): ArcShape => {
  const start: Point = { x: from.x + from.width + 2, y: from.y + from.height / 2 };
  const tip: Point = { x: to.x + to.width + 6, y: to.y + to.height / 2 };
  const base: Point = { x: tip.x + STEM, y: tip.y };
  const bulge = Math.max(start.x, base.x) + SIDE_BULGE + lane * LANE_SWING;
  return {
    path: `M ${start.x} ${start.y} C ${bulge} ${start.y}, ${bulge} ${base.y}, ${base.x} ${base.y} L ${tip.x} ${tip.y}`,
    base,
    tip,
  };
};

const getBow = (from: Point, to: Point, direction: number): number =>
  Math.max(MIN_BOW, Math.min(MAX_BOW, Math.abs(to.y - from.y) / 2)) * direction;

const getVerticalShape = (arc: PlacedArc): ArcShape => {
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
  return {
    path: `M ${start.x} ${start.y} ${feeder} C ${trunk.x + swing} ${trunk.y + bow}, ${base.x + swing} ${base.y - bow}, ${base.x} ${base.y} L ${tip.x} ${tip.y}`,
    base,
    tip,
  };
};

export const isSideArc = ({ from, to }: Pick<PlacedArc, "from" | "to">): boolean => {
  const gap = to.y > from.y ? to.y - (from.y + from.height) : from.y - (to.y + to.height);
  const reach = Math.abs(from.x + from.width / 2 - (to.x + to.width / 2));
  return gap < SIDE_GAP && reach < SIDE_REACH;
};

const getArcShape = (arc: PlacedArc): ArcShape =>
  isSideArc(arc) ? getSideShape(arc) : getVerticalShape(arc);

export const Arc = (arc: PlacedArc) => {
  const isActive = useIsCausalEdge(arc.edge.from, arc.edge.to);
  const hasHover = useHasHover();
  const isInactive = useIsInactive(arc.edge.from);
  const isMuted = (hasHover && !isActive) || isInactive;
  const shape = getArcShape(arc);
  const color = getSolidColor(arc.color);
  const isEvent = EVENT_ARC_KINDS.has(arc.edge.kind);
  return (
    <g opacity={isMuted ? 0.1 : isActive ? 1 : 0.55}>
      <path
        d={shape.path}
        fill="none"
        stroke={color}
        strokeWidth={isActive ? 1.75 : 1}
        strokeDasharray={isEvent ? "4 3" : undefined}
      />
      <ArrowHead from={shape.base} tip={shape.tip} color={color} size={7} isHollow={isEvent} />
    </g>
  );
};
