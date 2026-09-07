"use client";

import type { ReactNode } from "react";
import { Tree, type TreeViewProps, type TreeRootProps } from "./tree";

export interface TreeDiagramProps
  extends Omit<TreeViewProps, "children">, Omit<TreeRootProps, "children"> {
  children?: ReactNode;
}

export const TreeDiagram = ({
  nodes,
  dataflowEdges,
  onSelect,
  activeId,
  defaultActiveId,
  onActiveIdChange,
  children,
  ...viewProps
}: TreeDiagramProps) => (
  <Tree.Root
    nodes={nodes}
    dataflowEdges={dataflowEdges}
    onSelect={onSelect}
    activeId={activeId}
    defaultActiveId={defaultActiveId}
    onActiveIdChange={onActiveIdChange}
  >
    <Tree.View {...viewProps}>
      {children ?? (
        <>
          <Tree.Scopes />
          <Tree.Edges />
          <Tree.Items />
        </>
      )}
    </Tree.View>
  </Tree.Root>
);
