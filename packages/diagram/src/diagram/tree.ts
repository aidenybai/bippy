"use client";

import { TreeRoot } from "./tree-root";
import { TreeView } from "./tree-view";
import { TreeScopes } from "./tree-scopes";
import { TreeEdges } from "./tree-edges";
import { TreeItems, TreeItem, TreeDetail } from "./tree-items";

export const Tree = {
  Root: TreeRoot,
  View: TreeView,
  Scopes: TreeScopes,
  Edges: TreeEdges,
  Items: TreeItems,
  Item: TreeItem,
  Detail: TreeDetail,
};
export { TreeRoot, TreeView, TreeScopes, TreeEdges, TreeItems, TreeItem, TreeDetail };
export type { TreeRootProps } from "./tree-root";
export type { TreeViewProps } from "./tree-view";
export type { TreeScopesProps } from "./tree-scopes";
export type { TreeEdgesProps } from "./tree-edges";
export type { TreeItemsProps, TreeItemProps } from "./tree-items";
