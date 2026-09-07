"use client";

import { useMemo } from "react";
import { DiagramCanvas, DiagramEdge, DiagramNode, DiagramScope } from "./primitives";
import { getTreeRows, type TreeNode } from "./tree-model";
import { getTreeLayout } from "./tree-layout";
import { getOwnerNodes, getTreeHighlightIndex } from "./tree-highlight";
import {
  DiagramInteractionContext,
  useDiagramInteractionState,
  type DiagramInteraction,
} from "./interaction";
import { getDataflowIndex, getDataflowHighlight, type DataflowEdge } from "./dataflow-model";
import { getDataflowOffsets } from "./dataflow-geometry";
import { diagramMetrics, getEdgeLabelPosition, type EdgeGeometry } from "./geometry";

export interface TreeDiagramProps {
  nodes: readonly TreeNode[];
  dataflowEdges?: readonly DataflowEdge[];
  label: string;
  relationship?: "parent" | "owner";
  width?: number;
  rowHeight?: number;
  indent?: number;
  showOwners?: boolean;
  scopeId?: string;
  scopeLabel?: string;
  onSelect?: (nodeId: string) => void;
}

export const TreeDiagram = ({
  nodes,
  dataflowEdges,
  label,
  relationship = "parent",
  width = 400,
  rowHeight = diagramMetrics.rowHeight,
  indent = diagramMetrics.indent,
  showOwners = false,
  scopeId,
  scopeLabel = "Context",
  onSelect,
}: TreeDiagramProps) => {
  const model = useMemo(() => getTreeRows(nodes), [nodes]);
  const highlightIndex = useMemo(() => getTreeHighlightIndex(model), [model]);
  const rows = useMemo(
    () => (relationship === "owner" ? getTreeRows(getOwnerNodes(nodes)) : model),
    [model, nodes, relationship],
  );
  const baseInteraction = useDiagramInteractionState(highlightIndex, relationship);
  const flowIndex = useMemo(
    () => (dataflowEdges ? getDataflowIndex(nodes, dataflowEdges) : undefined),
    [nodes, dataflowEdges],
  );
  const activeNode =
    baseInteraction.activeId === null
      ? undefined
      : highlightIndex.nodeById.get(baseInteraction.activeId);
  const flow = useMemo(
    () =>
      flowIndex &&
      activeNode &&
      (activeNode.componentId !== undefined || activeNode.kind === "store")
        ? getDataflowHighlight(flowIndex, activeNode.id)
        : undefined,
    [flowIndex, activeNode],
  );
  const interaction = useMemo<DiagramInteraction>(
    () =>
      flow
        ? {
            ...baseInteraction,
            mode: "flow",
            highlightedIds: flow.nodeIds,
            highlightedEdgeIds: flow.edgeIds,
          }
        : baseInteraction,
    [baseInteraction, flow],
  );
  const { positions, offsets } = useMemo(
    () => getTreeLayout(rows, rowHeight, indent),
    [rows, rowHeight, indent],
  );
  const indexById = new Map(rows.map((row, index) => [row.node.id, index]));
  const hasOwnerArcs = showOwners && relationship === "parent" && interaction.mode === "owner";
  const scopeIndex =
    scopeId && relationship === "parent" && interaction.activeId === scopeId
      ? indexById.get(scopeId)
      : undefined;
  const scopePosition = scopeIndex === undefined ? undefined : positions[scopeIndex];
  return (
    <DiagramInteractionContext value={interaction}>
      <DiagramCanvas
        width={width}
        height={Math.max(rowHeight * 4, offsets[rows.length] + rowHeight / 2)}
        label={label}
      >
        {scopePosition && scopeIndex !== undefined && (
          <DiagramScope
            x={scopePosition.x - 12}
            y={offsets[scopeIndex]}
            width={width - scopePosition.x + 4}
            height={offsets[rows[scopeIndex].subtreeEnd] - offsets[scopeIndex]}
            label={scopeLabel}
            nodeId={scopeId}
          />
        )}
        {relationship === "parent" &&
          interaction.catchRanges.map((range, index) => (
            <DiagramScope
              key={range.start}
              kind="boundary"
              x={positions[range.start].x - 12}
              y={offsets[range.start]}
              width={width - positions[range.start].x + 4}
              height={offsets[range.end] - offsets[range.start]}
              label={
                index === 0
                  ? `catches: ${activeNode?.label ?? ""} ${activeNode?.annotation ?? ""}`
                  : ""
              }
            />
          ))}
        {rows.map((row, index) =>
          row.parentIndex < 0 || row.node.componentId !== undefined ? null : (
            <DiagramEdge
              key={row.node.id}
              from={positions[row.parentIndex]}
              to={positions[index]}
              fromId={row.node.parentId}
              toId={row.node.id}
            />
          ),
        )}
        {scopePosition &&
          rows.map((row, index) =>
            row.node.contextProviderIds?.includes(scopeId ?? "") ? (
              <DiagramEdge
                key={`context-${row.node.id}`}
                kind="context"
                from={scopePosition}
                to={positions[index]}
                fromId={scopeId}
                toId={row.node.id}
              />
            ) : null,
          )}
        {hasOwnerArcs &&
          rows.map((row, index) => {
            const ownerIndex =
              row.node.ownerId === interaction.activeId && row.node.ownerId !== row.node.parentId
                ? indexById.get(row.node.ownerId)
                : undefined;
            return ownerIndex === undefined ? null : (
              <DiagramEdge
                key={`owner-${row.node.id}`}
                from={positions[ownerIndex]}
                to={positions[index]}
                fromId={row.node.ownerId}
                toId={row.node.id}
                kind="owner"
                shape="curve"
              />
            );
          })}
        {flow &&
          dataflowEdges
            ?.filter((edge) => flow.edgeIds.has(edge.id))
            .map((edge) => {
              const fromIndex = indexById.get(edge.from);
              const toIndex = indexById.get(edge.to);
              if (fromIndex === undefined || toIndex === undefined)
                throw new Error(`Missing endpoint for edge ${edge.id}`);
              const fromNode = { ...rows[fromIndex].node, ...positions[fromIndex] };
              const toNode = { ...rows[toIndex].node, ...positions[toIndex] };
              const portOffsets = getDataflowOffsets(
                {
                  ...edge,
                  shape: "curve",
                  fromOffset:
                    edge.fromOffset ??
                    (fromNode.componentId ? { x: -diagramMetrics.detailPortGap, y: 0 } : undefined),
                  toOffset:
                    edge.toOffset ??
                    (toNode.componentId ? { x: -diagramMetrics.detailPortGap, y: 0 } : undefined),
                },
                fromNode,
                toNode,
              );
              const lane = dataflowEdges
                .filter(
                  (other) =>
                    (other.from === edge.from && other.to === edge.to) ||
                    (other.from === edge.to && other.to === edge.from),
                )
                .findIndex((other) => other.id === edge.id);
              const geometry: EdgeGeometry = {
                kind: edge.kind,
                shape: "curve",
                side: edge.side,
                bend: diagramMetrics.indent * (2 + lane),
                from: {
                  x: fromNode.x + portOffsets.fromOffset.x,
                  y: fromNode.y + portOffsets.fromOffset.y,
                },
                to: { x: toNode.x + portOffsets.toOffset.x, y: toNode.y + portOffsets.toOffset.y },
              };
              const labelPosition = getEdgeLabelPosition(geometry);
              return (
                <DiagramEdge
                  key={edge.id}
                  id={edge.id}
                  {...geometry}
                  directed
                  fromId={edge.from}
                  toId={edge.to}
                  label={
                    edge.from === activeNode?.id || edge.to === activeNode?.id
                      ? edge.label
                      : undefined
                  }
                  labelPosition={{
                    ...labelPosition,
                    y: labelPosition.y + lane * (diagramMetrics.annotationFontSize * 2 + 2),
                  }}
                />
              );
            })}
        {rows.map((row, index) => (
          <DiagramNode
            key={row.node.id}
            node={row.node}
            variant={row.node.componentId ? "detail" : "node"}
            hitHeight={offsets[index + 1] - offsets[index]}
            {...positions[index]}
            onSelect={onSelect}
          />
        ))}
      </DiagramCanvas>
    </DiagramInteractionContext>
  );
};
