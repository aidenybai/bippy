"use client";

import { TreeRoot } from "./tree-root";
import { TreeView } from "./tree-view";
import { TreeControls } from "./tree-controls";
import { TreeScopes } from "./tree-scopes";
import { TreeEdges } from "./tree-edges";
import { TreeItems, TreeItem, TreeDetail, TreeLabel, TreeDescription } from "./tree-items";

export const Tree = {
  Root: TreeRoot,
  View: TreeView,
  Controls: TreeControls,
  Scopes: TreeScopes,
  Edges: TreeEdges,
  Items: TreeItems,
  Item: TreeItem,
  Detail: TreeDetail,
  Label: TreeLabel,
  Description: TreeDescription,
};
export {
  TreeRoot,
  TreeView,
  TreeControls,
  TreeScopes,
  TreeEdges,
  TreeItems,
  TreeItem,
  TreeDetail,
  TreeLabel,
  TreeDescription,
};
export type { TreeRootProps } from "./tree-root";
export type { TreeViewProps } from "./tree-view";
export type { TreeScopesProps } from "./tree-scopes";
export type { TreeEdgesProps } from "./tree-edges";
export type { TreeItemsProps, TreeItemProps } from "./tree-items";
