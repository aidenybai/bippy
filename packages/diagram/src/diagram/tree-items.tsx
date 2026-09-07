"use client";

import { Fragment, type ComponentPropsWithRef, type ReactNode } from "react";
import { DiagramNode, type DiagramNodeProps } from "./primitives";
import { useTreeRoot, useTreeView } from "./tree-context";
import type { TreeNode } from "./tree-model";

export interface TreeItemProps extends Omit<DiagramNodeProps, "node" | "x" | "y" | "variant"> {
  id: string;
}

interface TreeRowItemProps extends TreeItemProps {
  variant: DiagramNodeProps["variant"];
}

export interface TreeItemsProps extends Omit<ComponentPropsWithRef<"g">, "children"> {
  children?: (node: TreeNode) => ReactNode;
}

const TreeRowItem = ({ id, variant, ...props }: TreeRowItemProps) => {
  const { onSelect } = useTreeRoot();
  const { rows, positions, offsets, indexById } = useTreeView();
  const index = indexById.get(id);
  if (index === undefined) throw new Error(`Unknown tree item: ${id}`);
  return (
    <DiagramNode
      data-slot={variant === "detail" ? "tree-detail" : "tree-item"}
      node={rows[index].node}
      {...positions[index]}
      hitHeight={offsets[index + 1] - offsets[index]}
      onSelect={onSelect}
      {...props}
      variant={variant}
    />
  );
};

export const TreeItem = (props: TreeItemProps) => <TreeRowItem {...props} variant="node" />;
export const TreeDetail = (props: TreeItemProps) => <TreeRowItem {...props} variant="detail" />;

export const TreeItems = ({ children, ...props }: TreeItemsProps) => {
  const { rows } = useTreeView();
  return (
    <g data-slot="tree-items" {...props}>
      {rows.map(({ node }) => (
        <Fragment key={node.id}>
          {children ? (
            children(node)
          ) : node.componentId ? (
            <TreeDetail id={node.id} />
          ) : (
            <TreeItem id={node.id} />
          )}
        </Fragment>
      ))}
    </g>
  );
};
