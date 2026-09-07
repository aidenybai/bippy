"use client";

import { useMemo } from "react";
import { DiagramCanvas, type DiagramCanvasProps } from "./primitives";
import { useTreeRoot, TreeViewContext } from "./tree-context";
import { DiagramInteractionContext, type DiagramInteraction } from "./interaction";
import { getTreeRows } from "./tree-model";
import { getOwnerNodes, getTreeHighlight } from "./tree-highlight";
import { getDataflowHighlight } from "./dataflow-model";
import { getTreeLayout } from "./tree-layout";
import { diagramMetrics } from "./geometry";

export interface TreeViewProps extends Omit<DiagramCanvasProps, "width" | "height" | "onSelect"> {
  relationship?: "parent" | "owner";
  width?: number;
  rowHeight?: number;
  indent?: number;
  showOwners?: boolean;
  scopeId?: string;
  scopeLabel?: string;
}

export const TreeView = ({
  relationship = "parent",
  width = 400,
  rowHeight = diagramMetrics.rowHeight,
  indent = diagramMetrics.indent,
  showOwners = false,
  scopeId,
  scopeLabel = "Context",
  label,
  children,
  ...props
}: TreeViewProps) => {
  const root = useTreeRoot();
  const rows = useMemo(
    () => (relationship === "owner" ? getTreeRows(getOwnerNodes(root.nodes)) : root.rows),
    [root.nodes, root.rows, relationship],
  );
  const layout = useMemo(() => getTreeLayout(rows, rowHeight, indent), [rows, rowHeight, indent]);
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows]);
  const activeNode =
    root.interaction.activeId === null
      ? undefined
      : root.highlightIndex.nodeById.get(root.interaction.activeId);
  const flow = useMemo(
    () =>
      root.flowIndex &&
      activeNode &&
      (activeNode.componentId !== undefined || activeNode.kind === "store")
        ? getDataflowHighlight(root.flowIndex, activeNode.id)
        : undefined,
    [root.flowIndex, activeNode],
  );
  const interaction = useMemo<DiagramInteraction>(() => {
    const next = {
      ...root.interaction,
      ...getTreeHighlight(root.highlightIndex, root.interaction.activeId, relationship),
    };
    if (flow) {
      next.mode = "flow";
      next.highlightedIds = flow.nodeIds;
      next.highlightedEdgeIds = flow.edgeIds;
    }
    return next;
  }, [root.interaction, root.highlightIndex, relationship, flow]);
  const scopeIndex =
    scopeId && relationship === "parent" && interaction.activeId === scopeId
      ? indexById.get(scopeId)
      : undefined;
  const context = useMemo(
    () => ({
      ...layout,
      rows,
      indexById,
      interaction,
      activeNode,
      flow,
      width,
      relationship,
      showOwners,
      scopeId,
      scopeLabel,
      scopeIndex,
    }),
    [
      layout,
      rows,
      indexById,
      interaction,
      activeNode,
      flow,
      width,
      relationship,
      showOwners,
      scopeId,
      scopeLabel,
      scopeIndex,
    ],
  );
  return (
    <TreeViewContext value={context}>
      <DiagramInteractionContext value={interaction}>
        <DiagramCanvas
          data-slot="tree-view"
          {...props}
          width={width}
          height={Math.max(rowHeight * 4, layout.offsets[rows.length] + rowHeight / 2)}
          label={label}
        >
          {children}
        </DiagramCanvas>
      </DiagramInteractionContext>
    </TreeViewContext>
  );
};
