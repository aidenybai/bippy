"use client";

import * as stylex from "@stylexjs/stylex";
import { drawing } from "./drawing.stylex";
import { Fragment, type ComponentPropsWithRef, type ReactNode } from "react";
import { DiagramNode, type DiagramNodeProps } from "./primitives";
import {
  DiagramLabel,
  DiagramDescription,
  type DiagramLabelProps,
  type DiagramDescriptionProps,
} from "./node-slots";
import { composeEventHandlers } from "./dom-props";
import { useTreeRoot, useTreeView } from "./tree-context";
import type { TreeNode } from "./tree-model";

export interface TreeItemProps extends Omit<
  DiagramNodeProps,
  "node" | "x" | "y" | "variant" | "role"
> {
  id: string;
  textValue?: string;
}

interface TreeRowItemProps extends TreeItemProps {
  variant: DiagramNodeProps["variant"];
}

export interface TreeItemsProps extends Omit<ComponentPropsWithRef<"g">, "children"> {
  children?: (node: TreeNode) => ReactNode;
}

const TreeRowItem = ({
  id,
  variant,
  textValue,
  onSelect: onItemSelect,
  ...props
}: TreeRowItemProps) => {
  const { onSelect, descriptions } = useTreeRoot();
  const {
    rows,
    positions,
    offsets,
    indexById,
    focusedId,
    setFocusedId,
    collapsedIds,
    toggle,
    scopeId,
    scopeLabel,
  } = useTreeView();
  const index = indexById.get(id);
  if (index === undefined) {
    if (!descriptions.has(id)) throw new Error(`Unknown tree item: ${id}`);
    return null;
  }
  const row = rows[index];
  return (
    <DiagramNode
      data-slot={variant === "detail" ? "tree-detail" : "tree-item"}
      node={row.node}
      {...positions[index]}
      hitHeight={offsets[index + 1] - offsets[index]}
      description={[
        descriptions.get(id),
        id === scopeId ? `Context scope: ${scopeLabel}.` : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
      data-tree-item=""
      data-text-value={textValue}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.position}
      aria-setsize={row.siblingCount}
      aria-expanded={row.hasChildren ? !collapsedIds.has(id) : undefined}
      tabIndex={id === focusedId ? 0 : -1}
      onFocus={composeEventHandlers(props.onFocus, (event) => {
        if (event.target === event.currentTarget) setFocusedId(id);
      })}
      onSelect={(nodeId) => {
        const action = onItemSelect ?? onSelect;
        if (action) action(nodeId);
        else if (row.hasChildren) toggle(nodeId);
      }}
      variant={variant}
    />
  );
};

export const TreeItem = (props: TreeItemProps) => <TreeRowItem {...props} variant="node" />;
export const TreeDetail = (props: TreeItemProps) => <TreeRowItem {...props} variant="detail" />;
export const TreeLabel = (props: DiagramLabelProps) => (
  <DiagramLabel data-slot="tree-label" {...props} />
);
export const TreeDescription = (props: DiagramDescriptionProps) => (
  <DiagramDescription data-slot="tree-description" {...props} />
);

export const TreeItems = ({ children, ...props }: TreeItemsProps) => {
  const { rows } = useTreeView();
  return (
    <g data-slot="tree-items" {...props} role="presentation">
      {rows.length === 0 && (
        <text x={20} y={24} aria-hidden="true" {...stylex.props(drawing.label)}>
          No nodes to display.
        </text>
      )}
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
