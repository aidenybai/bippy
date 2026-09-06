"use client";

import { useMemo } from "react";
import { DiagramScene } from "./diagram-scene";
import { getDataflowOffsets } from "./dataflow-geometry";
import {
  DiagramInteractionContext,
  useDiagramInteractionState,
  type DiagramInteraction,
} from "./interaction";
import {
  getDataflowIndex,
  getDataflowHighlight,
  type DataflowNode,
  type DataflowEdge,
} from "./dataflow-model";

export interface DataflowDiagramProps {
  nodes: readonly DataflowNode[];
  edges: readonly DataflowEdge[];
  width: number;
  height: number;
  label: string;
  onSelect?: (nodeId: string) => void;
}

export const DataflowDiagram = ({
  nodes,
  edges,
  width,
  height,
  label,
  onSelect,
}: DataflowDiagramProps) => {
  const index = useMemo(() => getDataflowIndex(nodes, edges), [nodes, edges]);
  const interaction = useDiagramInteractionState();
  const highlight = useMemo(
    () =>
      interaction.activeId === null ? undefined : getDataflowHighlight(index, interaction.activeId),
    [index, interaction.activeId],
  );
  const flowInteraction = useMemo<DiagramInteraction>(
    () => ({
      ...interaction,
      mode: highlight ? "flow" : "none",
      highlightedIds: highlight?.nodeIds ?? null,
      highlightedEdgeIds: highlight?.edgeIds,
    }),
    [interaction, highlight],
  );
  const directedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const from = index.nodeById.get(edge.from);
        const to = index.nodeById.get(edge.to);
        if (!from || !to) throw new Error(`Missing endpoint for edge ${edge.id}`);
        return { ...edge, directed: true, ...getDataflowOffsets(edge, from, to) };
      }),
    [edges, index],
  );
  return (
    <DiagramInteractionContext value={flowInteraction}>
      <DiagramScene
        nodes={nodes}
        edges={directedEdges}
        width={width}
        height={height}
        label={label}
        onSelect={onSelect}
      />
    </DiagramInteractionContext>
  );
};
