"use client";

import { useMemo } from "react";
import { DiagramCanvas, DiagramEdge, DiagramNode, DiagramScope } from "./primitives";
import { getTreeRows, type TreeNode } from "./tree-model";
import { getOwnerNodes, getTreeHighlightIndex } from "./tree-highlight";
import { DiagramInteractionContext, useDiagramInteractionState } from "./interaction";
import { diagramMetrics } from "./geometry";

export interface TreeDiagramProps {
  nodes: readonly TreeNode[];
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
  const interaction = useDiagramInteractionState(highlightIndex, relationship);
  const positions = rows.map((row, index) => ({
    x: diagramMetrics.indent * 2 + row.depth * indent,
    y: rowHeight / 2 + index * rowHeight,
  }));
  const indexById = new Map(rows.map((row, index) => [row.node.id, index]));
  const hasOwnerArcs = showOwners && relationship === "parent";
  if (hasOwnerArcs) {
    let minimumX = 0;
    for (const [index, row] of rows.entries()) {
      const ownerIndex =
        row.node.ownerId && row.node.ownerId !== row.node.parentId
          ? indexById.get(row.node.ownerId)
          : undefined;
      if (ownerIndex === undefined) continue;
      const from = positions[ownerIndex];
      const to = positions[index];
      minimumX = Math.min(
        minimumX,
        (from.x + to.x) / 2 - Math.hypot(to.x - from.x, to.y - from.y) / 2 - 8,
      );
    }
    if (minimumX < 0) for (const position of positions) position.x -= minimumX;
  }
  const scopeIndex =
    scopeId && relationship === "parent" && interaction.activeId === scopeId
      ? indexById.get(scopeId)
      : undefined;
  const scopePosition = scopeIndex === undefined ? undefined : positions[scopeIndex];
  const activeNode =
    interaction.activeId === null ? undefined : highlightIndex.nodeById.get(interaction.activeId);
  return (
    <DiagramInteractionContext value={interaction}>
      <DiagramCanvas
        width={width}
        height={Math.max(rowHeight * 4, rows.length * rowHeight + rowHeight / 2)}
        label={label}
      >
        {scopePosition && scopeIndex !== undefined && (
          <DiagramScope
            x={scopePosition.x - 12}
            y={scopePosition.y - rowHeight / 2}
            width={width - scopePosition.x + 4}
            height={(rows[scopeIndex].subtreeEnd - scopeIndex) * rowHeight}
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
              y={positions[range.start].y - rowHeight / 2}
              width={width - positions[range.start].x + 4}
              height={(range.end - range.start) * rowHeight}
              label={
                index === 0
                  ? `catches: ${activeNode?.label ?? ""} ${activeNode?.annotation ?? ""}`
                  : ""
              }
            />
          ))}
        {rows.map((row, index) =>
          row.parentIndex < 0 ? null : (
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
              row.node.ownerId && row.node.ownerId !== row.node.parentId
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
              />
            );
          })}
        {rows.map((row, index) => (
          <DiagramNode
            key={row.node.id}
            node={row.node}
            {...positions[index]}
            onSelect={onSelect}
          />
        ))}
      </DiagramCanvas>
    </DiagramInteractionContext>
  );
};
