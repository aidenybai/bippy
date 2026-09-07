"use client";

import { createContext, useContext } from "react";
import type { TreeNode, TreeRow } from "./tree-model";
import type { TreeHighlightIndex } from "./tree-highlight";
import type { DiagramInteraction } from "./interaction";
import type { DataflowIndex, DataflowEdge, DataflowHighlight } from "./dataflow-model";
import type { TreeLayout } from "./tree-layout";

export interface TreeRootContextValue {
  nodes: readonly TreeNode[];
  rows: readonly TreeRow[];
  highlightIndex: TreeHighlightIndex;
  flowIndex?: DataflowIndex<TreeNode>;
  dataflowEdges: readonly DataflowEdge[];
  descriptions: ReadonlyMap<string, string>;
  interaction: DiagramInteraction;
  onSelect?: (nodeId: string) => void;
}

export interface TreeViewContextValue extends TreeLayout {
  label: string;
  model: readonly TreeRow[];
  reveal: (nodeId: string, shouldFocus: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  rows: readonly TreeRow[];
  indexById: ReadonlyMap<string, number>;
  interaction: DiagramInteraction;
  activeNode?: TreeNode;
  flow?: DataflowHighlight;
  width: number;
  relationship: "parent" | "owner";
  showOwners: boolean;
  scopeId?: string;
  scopeIndex?: number;
  focusedId: string | null;
  setFocusedId: (nodeId: string) => void;
  collapsedIds: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
  scopeLabel: string;
}

export const TreeRootContext = createContext<TreeRootContextValue | null>(null);
export const TreeViewContext = createContext<TreeViewContextValue | null>(null);

export const useTreeRoot = () => {
  const context = useContext(TreeRootContext);
  if (!context) throw new Error("Tree parts must be used within Tree.Root");
  return context;
};

export const useTreeView = () => {
  const context = useContext(TreeViewContext);
  if (!context) throw new Error("Tree rendering parts must be used within Tree.View");
  return context;
};
