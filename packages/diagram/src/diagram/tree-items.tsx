"use client";

import * as stylex from "@stylexjs/stylex";
import { drawing } from "./drawing.stylex";
import { Fragment, useMemo, useRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { mergeRefs } from "@react-aria/utils";
import { TreeDisclosure } from "./tree-disclosure";
import { DiagramNode, type DiagramNodeProps } from "./primitives";
import {
  DiagramLabel,
  DiagramDescription,
  type DiagramLabelProps,
  type DiagramDescriptionProps,
} from "./node-slots";
import { composeEventHandlers, mergeClassNames } from "./dom-props";
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
  ref,
  ...props
}: TreeRowItemProps) => {
  const { onSelect, descriptions } = useTreeRoot();
  const nodeRef = useRef<SVGGElement>(null);
  const mergedRef = useMemo(() => mergeRefs(nodeRef, ref), [ref]);
  const {
    rows,
    width,
    positions,
    offsets,
    indexById,
    focusedId,
    setFocusedId,
    collapsedIds,
    toggle,
    scopeId,
    scopeLabel,
    interaction,
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
      hitLeft={-positions[index].x}
      hitWidth={width}
      maxWidth={Math.max(24, width - positions[index].x - 20)}
      description={[
        descriptions.get(id),
        id === scopeId ? `Context scope: ${scopeLabel}.` : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
      className={mergeClassNames(stylex.props(stylex.defaultMarker()).className, props.className)}
      ref={mergedRef}
      data-tree-item=""
      data-focused={id === focusedId || undefined}
      data-depth={row.depth}
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
    >
      {props.children ?? <DiagramLabel />}
      {row.hasChildren &&
        props.isInteractive !== false &&
        props["aria-disabled"] !== true &&
        props["aria-disabled"] !== "true" && (
          <TreeDisclosure
            nodeId={id}
            x={12 - positions[index].x}
            y={0}
            height={offsets[index + 1] - offsets[index]}
            isExpanded={!collapsedIds.has(id)}
            onToggle={(_event, isFocusDriven) => {
              toggle(id);
              nodeRef.current?.focus({ preventScroll: true });
              interaction.setFocusedId(id, isFocusDriven);
            }}
          />
        )}
    </DiagramNode>
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
  const { mountedRows: rows } = useTreeView();
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
