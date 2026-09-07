"use client";

import { useMemo } from "react";
import type { DiagramRootProps } from "./diagram-root";
import { DiagramInteractionContext, useDiagramInteractionState } from "./interaction";
import { getTreeRows, type TreeNode } from "./tree-model";
import { getTreeHighlightIndex } from "./tree-highlight";
import { getDataflowIndex, type DataflowEdge } from "./dataflow-model";
import { TreeRootContext } from "./tree-context";

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
      interaction,
      onSelect,
    }),
    [nodes, rows, highlightIndex, flowIndex, dataflowEdges, interaction, onSelect],
  );
  return (
    <TreeRootContext value={context}>
      <DiagramInteractionContext value={interaction}>{children}</DiagramInteractionContext>
    </TreeRootContext>
  );
};
