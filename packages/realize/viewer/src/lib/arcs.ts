import type { PlacedToken } from "@/hooks/use-token-boxes";
import type { GraphEdge, ViewFile } from "@/model";
import { isSideArc, type PlacedArc } from "@/components/viewer/arc";
import type { Point } from "@/components/viewer/arrow-head";
import type { Box } from "./positions";

const RESTING_ARC_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);

const LANE_X_REACH = 64;
const JUNCTION_GAP = 12;

interface Endpoint {
  arcIndex: number;
  end: "from" | "to";
  group: string;
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

const getBundleKey = (arc: Pick<PlacedArc, "edge" | "from" | "to">): string =>
  `${arc.edge.to}:${arc.edge.kind}:${arc.to.y > arc.from.y ? "down" : "up"}`;

const isCrowding = (
  arc: Pick<PlacedArc, "edge" | "from" | "to">,
  other: Pick<PlacedArc, "edge" | "from" | "to">,
): boolean =>
  getBundleKey(arc) !== getBundleKey(other) &&
  isOverlapping(arc, other) &&
  Math.abs(getMidX(arc) - getMidX(other)) < LANE_X_REACH;

const getAverage = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const assignLanes = (arcs: Omit<PlacedArc, "lane">[]): PlacedArc[] => {
  const placed: PlacedArc[] = [];
  const laneByBundle = new Map<string, number>();
  const byLength = [...arcs].sort((left, right) => getSpanLength(right) - getSpanLength(left));
  for (const arc of byLength) {
    const taken = new Set(
      placed.filter((other) => isCrowding(arc, other)).map((other) => other.lane),
    );
    const lane =
      laneByBundle.get(getBundleKey(arc)) ??
      Array.from({ length: taken.size + 1 }, (_unused, index) => index).find(
        (candidate) => !taken.has(candidate),
      ) ??
      0;
    laneByBundle.set(getBundleKey(arc), lane);
    placed.push({ ...arc, lane });
  }
  return arcs.map(
    (arc) => placed.find((candidate) => candidate.edge === arc.edge) ?? { ...arc, lane: 0 },
  );
};

const getJunction = (bundle: Omit<PlacedArc, "lane" | "junction">[]): Point | null => {
  const [first] = bundle;
  if (!first || bundle.length < 2) return null;
  const isDownward = first.to.y > first.from.y;
  const nearest = bundle.reduce((best, arc) =>
    isDownward === arc.from.y > best.from.y ? arc : best,
  );
  const x = nearest.from.x + nearest.from.width * nearest.fromSlot;
  if (isDownward) {
    const y = nearest.from.y + nearest.from.height + JUNCTION_GAP;
    return y < first.to.y - JUNCTION_GAP ? { x, y } : null;
  }
  const y = nearest.from.y - JUNCTION_GAP;
  return y > first.to.y + first.to.height + JUNCTION_GAP ? { x, y } : null;
};

const assignJunctions = (
  arcs: Omit<PlacedArc, "lane" | "junction">[],
): Omit<PlacedArc, "lane">[] => {
  const bundles = Map.groupBy(
    arcs.filter((arc) => !isSideArc(arc)),
    getBundleKey,
  );
  const junctionByBundle = new Map([...bundles].map(([key, bundle]) => [key, getJunction(bundle)]));
  return arcs.map((arc) => ({
    ...arc,
    junction: isSideArc(arc) ? null : (junctionByBundle.get(getBundleKey(arc)) ?? null),
  }));
};

const assignSlots = (
  arcs: Omit<PlacedArc, "fromSlot" | "toSlot" | "lane" | "junction">[],
): Omit<PlacedArc, "lane" | "junction">[] => {
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
        {
          arcIndex,
          end,
          group: end === "to" ? `to:${arc.edge.kind}` : `from:${arcIndex}`,
          otherX: getCenterX(other),
        },
      ]);
  });
  const slots = new Map<string, number>();
  for (const endpoints of endpointsBySide.values()) {
    const groups = Map.groupBy(endpoints, (endpoint) => endpoint.group);
    [...groups.values()]
      .sort(
        (left, right) =>
          getAverage(left.map((endpoint) => endpoint.otherX)) -
          getAverage(right.map((endpoint) => endpoint.otherX)),
      )
      .forEach((group, order) => {
        for (const endpoint of group)
          slots.set(`${endpoint.arcIndex}:${endpoint.end}`, (order + 1) / (groups.size + 1));
      });
  }
  return arcs.map((arc, arcIndex) => ({
    ...arc,
    fromSlot: slots.get(`${arcIndex}:from`) ?? 0.5,
    toSlot: slots.get(`${arcIndex}:to`) ?? 0.5,
  }));
};

export const placeArcs = (
  view: ViewFile,
  tokens: PlacedToken[],
  colorByNodeId: Map<string, string>,
  isWanted: (edge: GraphEdge) => boolean,
): PlacedArc[] => {
  const boxes = new Map<string, Box>();
  for (const token of tokens)
    if (token.anchorBox) boxes.set(token.node.id, token.anchorBox);
    else if (!token.isMultiLine) boxes.set(token.node.id, token.box);
  const arcs = view.components
    .flatMap((component) => component.graph.edges)
    .filter(isWanted)
    .flatMap((edge) => {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      const color = colorByNodeId.get(edge.to) ?? colorByNodeId.get(edge.from);
      return from && to && color && from.y !== to.y ? [{ edge, from, to, color }] : [];
    });
  return assignLanes(assignJunctions(assignSlots(arcs)));
};

export const isRestingArc = (edge: GraphEdge): boolean => RESTING_ARC_KINDS.has(edge.kind);
