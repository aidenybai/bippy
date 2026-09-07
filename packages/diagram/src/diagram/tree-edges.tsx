"use client";

import type { ComponentPropsWithRef } from "react";
import { DiagramEdge } from "./primitives";
import { useTreeRoot, useTreeView } from "./tree-context";
import { getDataflowOffsets } from "./dataflow-geometry";
import { diagramMetrics, getEdgeLabelPosition, type EdgeGeometry } from "./geometry";

export interface TreeEdgesProps extends Omit<ComponentPropsWithRef<"g">, "children"> {}

export const TreeEdges = (props: TreeEdgesProps) => {
  const { dataflowEdges } = useTreeRoot();
  const {
    rows,
    positions,
    indexById,
    interaction,
    activeNode,
    flow,
    relationship,
    showOwners,
    scopeIndex,
    scopeId,
  } = useTreeView();
  return (
    <g data-slot="tree-edges" {...props}>
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
      {scopeIndex !== undefined &&
        rows.map((row, index) =>
          row.node.contextProviderIds?.includes(scopeId ?? "") ? (
            <DiagramEdge
              key={`context-${row.node.id}`}
              kind="context"
              from={positions[scopeIndex]}
              to={positions[index]}
              fromId={scopeId}
              toId={row.node.id}
            />
          ) : null,
        )}
      {showOwners &&
        relationship === "parent" &&
        interaction.mode === "owner" &&
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
          .filter((edge) => flow.edgeIds.has(edge.id))
          .map((edge) => {
            const fromIndex = indexById.get(edge.from);
            const toIndex = indexById.get(edge.to);
            if (fromIndex === undefined || toIndex === undefined) return null;
            const fromNode = { ...rows[fromIndex].node, ...positions[fromIndex] };
            const toNode = { ...rows[toIndex].node, ...positions[toIndex] };
            const offsets = getDataflowOffsets(
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
              from: { x: fromNode.x + offsets.fromOffset.x, y: fromNode.y + offsets.fromOffset.y },
              to: { x: toNode.x + offsets.toOffset.x, y: toNode.y + offsets.toOffset.y },
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
    </g>
  );
};
