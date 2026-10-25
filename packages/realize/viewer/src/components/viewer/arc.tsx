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
const RAIL_MIN_GAP = 60;
const RAIL_FEED = 3;
const HEAD_SIZE = 7;
const RAIL_HEAD_SIZE = 6;
export const RAIL_RADIUS = 4;

const EVENT_ARC_KINDS = new Set<GraphEdge["kind"]>(["triggers", "writes"]);

export interface PlacedArc {
  edge: GraphEdge;
  from: Box;
  to: Box;
  fromSlot: number;
  toSlot: number;
  lane: number;
  rail: number | null;
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
  const bow = Math.max(MIN_BOW, Math.min(MAX_BOW, Math.abs(base.y - start.y) / 2)) * direction;
  const swing = getLaneSwing(arc.lane);
  return {
    path: `M ${start.x} ${start.y} C ${start.x + swing} ${start.y + bow}, ${base.x + swing} ${base.y - bow}, ${base.x} ${base.y} L ${tip.x} ${tip.y}`,
    base,
    tip,
  };
};

export const isSideArc = ({ from, to }: Pick<PlacedArc, "from" | "to">): boolean => {
  const gap = to.y > from.y ? to.y - (from.y + from.height) : from.y - (to.y + to.height);
  const reach = Math.abs(from.x + from.width / 2 - (to.x + to.width / 2));
  return gap < SIDE_GAP && reach < SIDE_REACH;
};

export const isRailArc = (arc: Pick<PlacedArc, "from" | "to">): boolean => {
  const gap =
    arc.to.y > arc.from.y
      ? arc.to.y - (arc.from.y + arc.from.height)
      : arc.from.y - (arc.to.y + arc.to.height);
  return gap > RAIL_MIN_GAP;
};

const getRailShape = (arc: PlacedArc, railX: number): ArcShape => {
  const direction = arc.to.y > arc.from.y ? 1 : -1;
  const startX = getSlotX(arc.from, arc.fromSlot);
  const startY = direction === 1 ? arc.from.y + arc.from.height : arc.from.y;
  const tip: Point = {
    x: getSlotX(arc.to, arc.toSlot),
    y: direction === 1 ? arc.to.y : arc.to.y + arc.to.height,
  };
  const base: Point = { x: tip.x, y: tip.y - RAIL_HEAD_SIZE * direction };
  const feedY = startY + RAIL_FEED * direction;
  const turn = RAIL_RADIUS * direction;
  return {
    path: [
      `M ${startX} ${startY}`,
      `Q ${startX} ${feedY} ${startX - RAIL_RADIUS} ${feedY}`,
      `L ${railX + RAIL_RADIUS} ${feedY}`,
      `Q ${railX} ${feedY} ${railX} ${feedY + turn}`,
      `L ${railX} ${base.y - turn}`,
      `Q ${railX} ${base.y} ${railX + RAIL_RADIUS} ${base.y}`,
      `L ${base.x} ${base.y}`,
    ].join(" "),
    base,
    tip,
  };
};

const getArcShape = (arc: PlacedArc): ArcShape => {
  if (arc.rail !== null) return getRailShape(arc, arc.rail);
  return isSideArc(arc) ? getSideShape(arc) : getVerticalShape(arc);
};

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
      <ArrowHead
        from={shape.base}
        tip={shape.tip}
        color={color}
        size={arc.rail === null ? HEAD_SIZE : RAIL_HEAD_SIZE}
        isHollow={isEvent}
      />
    </g>
  );
};
