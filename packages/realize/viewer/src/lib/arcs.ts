import type { TokenLayout } from "@/hooks/use-token-boxes";
import type { GraphEdge, ViewFile } from "@/model";
import { isRailArc, isSideArc, RAIL_RADIUS, type PlacedArc } from "@/components/viewer/arc";
import type { Box } from "./positions";

const RESTING_ARC_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);

const LANE_X_REACH = 64;
const RAIL_INSET = -3;
const RAIL_GAP = 3.5;
const RAIL_CLEARANCE = 3;

interface Endpoint {
  arcIndex: number;
  end: "from" | "to";
  otherX: number;
}

const getCenterX = (box: Box): number => box.x + box.width / 2;

const getSpan = (arc: Pick<PlacedArc, "from" | "to">): [number, number] => [
  Math.min(arc.from.y, arc.to.y),
  Math.max(arc.from.y + arc.from.height, arc.to.y + arc.to.height),
];

const getMidX = (arc: Pick<PlacedArc, "from" | "to">): number =>
  (arc.from.x + arc.from.width / 2 + arc.to.x + arc.to.width / 2) / 2;

const getSpanLength = (arc: Pick<PlacedArc, "from" | "to">): number => {
  const [top, bottom] = getSpan(arc);
  return bottom - top;
};

const isOverlapping = (
  arc: Pick<PlacedArc, "from" | "to">,
  other: Pick<PlacedArc, "from" | "to">,
): boolean => {
  const [top, bottom] = getSpan(arc);
  const [otherTop, otherBottom] = getSpan(other);
  return top < otherBottom && otherTop < bottom;
};

const isCrowding = (
  arc: Pick<PlacedArc, "from" | "to">,
  other: Pick<PlacedArc, "from" | "to">,
): boolean => isOverlapping(arc, other) && Math.abs(getMidX(arc) - getMidX(other)) < LANE_X_REACH;

const isSharingRail = (
  arc: Pick<PlacedArc, "edge" | "from" | "to">,
  other: Pick<PlacedArc, "edge" | "from" | "to">,
): boolean =>
  !isOverlapping(arc, other) ||
  (arc.edge.to === other.edge.to && arc.edge.kind === other.edge.kind);

const assignRails = (
  arcs: Omit<PlacedArc, "lane" | "rail">[],
  codeLeft: number,
  getRailLimit: (arc: Omit<PlacedArc, "lane" | "rail">) => number,
): Omit<PlacedArc, "lane">[] => {
  const railLanes: Omit<PlacedArc, "lane" | "rail">[][] = [];
  const railByArc = new Map<Omit<PlacedArc, "lane" | "rail">, number>();
  const candidates = arcs
    .filter(isRailArc)
    .sort((left, right) => getSpanLength(right) - getSpanLength(left));
  for (const arc of candidates) {
    const freeLane = railLanes.findIndex((lane) =>
      lane.every((other) => isSharingRail(arc, other)),
    );
    const lane = freeLane === -1 ? railLanes.length : freeLane;
    const railX = codeLeft + RAIL_INSET + lane * RAIL_GAP;
    if (railX + RAIL_RADIUS >= Math.min(arc.from.x, arc.to.x, getRailLimit(arc))) continue;
    railLanes[lane] = [...(railLanes[lane] ?? []), arc];
    railByArc.set(arc, railX);
  }
  return arcs.map((arc) => ({ ...arc, rail: railByArc.get(arc) ?? null }));
};

const assignLanes = (arcs: Omit<PlacedArc, "lane">[]): PlacedArc[] => {
  const placed: PlacedArc[] = [];
  const byLength = arcs
    .filter((arc) => arc.rail === null)
    .sort((left, right) => getSpanLength(right) - getSpanLength(left));
  for (const arc of byLength) {
    const taken = new Set(
      placed.filter((other) => isCrowding(arc, other)).map((other) => other.lane),
    );
    const lane = Array.from({ length: taken.size + 1 }, (_unused, index) => index).find(
      (candidate) => !taken.has(candidate),
    );
    placed.push({ ...arc, lane: lane ?? 0 });
  }
  return arcs.map(
    (arc) => placed.find((candidate) => candidate.edge === arc.edge) ?? { ...arc, lane: 0 },
  );
};

const assignSlots = (
  arcs: Omit<PlacedArc, "fromSlot" | "toSlot" | "lane" | "rail">[],
): Omit<PlacedArc, "lane" | "rail">[] => {
  const endpointsBySide = new Map<string, Endpoint[]>();
  arcs.forEach((arc, arcIndex) => {
    if (isSideArc(arc)) return;
    const isDownward = arc.to.y > arc.from.y;
    const sides: Array<[Endpoint["end"], string, Box]> = [
      ["from", `${arc.edge.from}:${isDownward ? "bottom" : "top"}`, arc.to],
      ["to", `${arc.edge.to}:${isDownward ? "top" : "bottom"}`, arc.from],
    ];
    for (const [end, side, other] of sides)
      endpointsBySide.set(side, [
        ...(endpointsBySide.get(side) ?? []),
        { arcIndex, end, otherX: getCenterX(other) },
      ]);
  });
  const slots = new Map<string, number>();
  for (const endpoints of endpointsBySide.values())
    [...endpoints]
      .sort((left, right) => left.otherX - right.otherX)
      .forEach((endpoint, order) =>
        slots.set(`${endpoint.arcIndex}:${endpoint.end}`, (order + 1) / (endpoints.length + 1)),
      );
  return arcs.map((arc, arcIndex) => ({
    ...arc,
    fromSlot: slots.get(`${arcIndex}:from`) ?? 0.5,
    toSlot: slots.get(`${arcIndex}:to`) ?? 0.5,
  }));
};

export const placeArcs = (
  view: ViewFile,
  layout: TokenLayout,
  colorByNodeId: Map<string, string>,
  isWanted: (edge: GraphEdge) => boolean,
): PlacedArc[] => {
  const boxes = new Map<string, Box>();
  const lineByNodeId = new Map<string, number>();
  for (const token of layout.tokens) {
    if (token.anchorBox) boxes.set(token.node.id, token.anchorBox);
    else if (!token.isMultiLine) boxes.set(token.node.id, token.box);
    lineByNodeId.set(token.node.id, (token.node.anchor ?? token.node.loc).start.line);
  }
  const sample = layout.tokens.find(
    (token) =>
      !token.anchorBox &&
      !token.isMultiLine &&
      token.node.loc.end.column > token.node.loc.start.column,
  );
  const charWidth = sample
    ? sample.box.width / (sample.node.loc.end.column - sample.node.loc.start.column)
    : 0;
  const textLeft = sample ? sample.box.x - sample.node.loc.start.column * charWidth : 0;
  const indents = view.source
    .split("\n")
    .map((line) => (line.trim() === "" ? Infinity : line.length - line.trimStart().length));
  const getRailLimit = (arc: Omit<PlacedArc, "lane" | "rail">): number => {
    const fromLine = lineByNodeId.get(arc.edge.from) ?? 0;
    const toLine = lineByNodeId.get(arc.edge.to) ?? 0;
    const between = indents.slice(Math.min(fromLine, toLine), Math.max(fromLine, toLine) - 1);
    return textLeft + Math.min(...between) * charWidth - RAIL_CLEARANCE;
  };
  const arcs = view.components
    .flatMap((component) => component.graph.edges)
    .filter(isWanted)
    .flatMap((edge) => {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      const color = colorByNodeId.get(edge.to) ?? colorByNodeId.get(edge.from);
      return from && to && color && from.y !== to.y ? [{ edge, from, to, color }] : [];
    });
  return assignLanes(assignRails(assignSlots(arcs), layout.codeLeft, getRailLimit));
};

export const isRestingArc = (edge: GraphEdge): boolean => RESTING_ARC_KINDS.has(edge.kind);
