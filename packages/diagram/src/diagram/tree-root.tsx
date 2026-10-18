"use client";

import { useMemo } from "react";
import type { DiagramRootProps } from "./diagram-root";
import { DiagramInteractionContext, useDiagramInteractionState } from "./interaction";
import { getTreeRows, type TreeNode } from "./tree-model";
import { getTreeHighlightIndex } from "./tree-highlight";
import { getDataflowIndex, type DataflowEdge } from "./dataflow-model";
import { getTreeDescriptions } from "./accessibility";
import { NodeContext } from "./node-context";
import { TreeRootContext, TreeViewContext } from "./tree-context";

export interface TreeRootProps extends DiagramRootProps {
  nodes: readonly TreeNode[];
  dataflowEdges?: readonly DataflowEdge[];
  onSelect?: (nodeId: string) => void;
}

const emptyEdges: readonly DataflowEdge[] = [];

export const TreeRoot = ({
  nodes,
  dataflowEdges,
  onSelect,
  children,
  ...options
}: TreeRootProps) => {
  const rows = useMemo(() => getTreeRows(nodes), [nodes]);
  const highlightIndex = useMemo(() => getTreeHighlightIndex(rows), [rows]);
  const flowIndex = useMemo(
    () => (dataflowEdges ? getDataflowIndex(nodes, dataflowEdges) : undefined),
    [nodes, dataflowEdges],
  );
  const descriptions = useMemo(
    () => getTreeDescriptions(nodes, dataflowEdges ?? emptyEdges),
    [nodes, dataflowEdges],
  );
  const interaction = useDiagramInteractionState(undefined, "parent", {
    ...options,
    inherit: false,
  });
  const context = useMemo(
    () => ({
      nodes,
      rows,
      highlightIndex,
      flowIndex,
      dataflowEdges: dataflowEdges ?? emptyEdges,
      descriptions,
      interaction,
      onSelect,
    }),
    [nodes, rows, highlightIndex, flowIndex, dataflowEdges, descriptions, interaction, onSelect],
  );
  return (
    <TreeRootContext value={context}>
      <TreeViewContext value={null}>
        <NodeContext value={null}>
          <DiagramInteractionContext value={interaction}>{children}</DiagramInteractionContext>
        </NodeContext>
      </TreeViewContext>
    </TreeRootContext>
  );
};
