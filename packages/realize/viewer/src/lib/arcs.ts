import type { PlacedToken } from "@/hooks/use-token-boxes";
import type { GraphEdge, ViewFile } from "@/model";
import type { PlacedArc } from "@/components/viewer/arc";
import type { Box } from "./positions";

const RESTING_ARC_KINDS = new Set<GraphEdge["kind"]>(["writes", "decides"]);

const countBy = (arcs: Pick<PlacedArc, "edge">[], side: "from" | "to"): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const { edge } of arcs) counts.set(edge[side], (counts.get(edge[side]) ?? 0) + 1);
  return counts;
};

const assignSlots = (arcs: Omit<PlacedArc, "fromSlot" | "toSlot">[]): PlacedArc[] => {
  const fromCounts = countBy(arcs, "from");
  const toCounts = countBy(arcs, "to");
  const fromSeen = new Map<string, number>();
  const toSeen = new Map<string, number>();
  const slot = (seen: Map<string, number>, counts: Map<string, number>, id: string): number => {
    const order = seen.get(id) ?? 0;
    seen.set(id, order + 1);
    return (order + 1) / ((counts.get(id) ?? 1) + 1);
  };
  return arcs.map((arc) => ({
    ...arc,
    fromSlot: slot(fromSeen, fromCounts, arc.edge.from),
    toSlot: slot(toSeen, toCounts, arc.edge.to),
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
  return assignSlots(arcs);
};

export const isRestingArc = (edge: GraphEdge): boolean => RESTING_ARC_KINDS.has(edge.kind);
