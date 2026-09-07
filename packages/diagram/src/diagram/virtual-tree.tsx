"use client";

import * as stylex from "@stylexjs/stylex";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useFocusRing } from "@react-aria/focus";
import { isFocusVisible as getIsFocusVisible } from "@react-aria/interactions";
import { useLocale } from "@react-aria/i18n";
import { fonts, fontSizes, spacing } from "tailwind-stylex/tokens.stylex";
import { colors } from "./tokens.stylex";
import { diagramMetrics } from "./geometry";
import { DiagramNode } from "./primitives";
import { drawing } from "./drawing.stylex";
import { DiagramInteractionContext, useDiagramInteractionState } from "./interaction";
import {
  getNodeName,
  getTreeDescriptions,
  getTreeKeyAction,
  treeInstructions,
} from "./accessibility";
import { useTypeahead } from "./use-typeahead";
import { TreeDisclosure } from "./tree-disclosure";
import { TreeTools } from "./tree-controls";
import { getCollapsedTreeIds, getRevealedTreeIds, type TreeRevealRequest } from "./tree-expansion";
import {
  getExpandedRows,
  getIndentation,
  getNodeOffset,
  getTreeRows,
  getVirtualRange,
  type TreeNode,
} from "./tree-model";

export interface VirtualTreeProps {
  nodes: readonly TreeNode[];
  label: string;
  height?: number;
  rowHeight?: number;
  onSelect?: (node: TreeNode) => void;
  controls?: boolean;
}

export interface VirtualViewportProps {
  count: number;
  rowHeight: number;
  height: number;
}

const styles = stylex.create({
  viewport: (height: number) => ({
    height,
    overflowY: "auto",
    overflowX: "hidden",
    position: "relative",
    outline: "none",
    scrollbarColor: `${colors.border} transparent`,
    scrollbarWidth: "thin",
  }),
  spacer: (height: number) => ({ height, position: "relative" }),
  window: (offset: number) => ({
    position: "absolute",
    top: offset,
    left: 0,
    display: "block",
    overflow: "hidden",
  }),
  empty: {
    padding: spacing[4],
    fontFamily: fonts.sans,
    fontSize: fontSizes.xs,
    color: colors.muted,
  },
  focus: {
    outline: `2px solid ${colors.blue}`,
    outlineOffset: -2,
    "@media (forced-colors: active)": { outlineColor: "Highlight" },
  },
  description: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    borderWidth: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});

export const useVirtualViewport = ({ count, rowHeight, height }: VirtualViewportProps) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const nextTop = Math.min(element.scrollTop, Math.max(0, count * rowHeight - height));
    element.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [count, rowHeight, height]);
  return {
    viewportRef,
    width,
    setScrollTop,
    range: getVirtualRange(count, scrollTop, height, rowHeight),
  };
};

export const VirtualTree = ({
  nodes,
  label,
  height = 396,
  rowHeight = diagramMetrics.rowHeight,
  onSelect,
  controls = false,
}: VirtualTreeProps) => {
  const viewportHeight = Math.max(rowHeight, height - (controls ? 32 : 0));
  const [revealRequest, setRevealRequest] = useState<TreeRevealRequest | null>(null);
  const treeId = useId();
  const interaction = useDiagramInteractionState(undefined, "parent", { inherit: false });
  const { focusProps, isFocused, isFocusVisible } = useFocusRing();
  const { direction } = useLocale();
  const findMatch = useTypeahead();
  const model = useMemo(() => getTreeRows(nodes), [nodes]);
  const modelIndexById = useMemo(
    () => new Map(model.map((row, index) => [row.node.id, index])),
    [model],
  );
  const descriptions = useMemo(() => getTreeDescriptions(nodes, []), [nodes]);
  const lastComponentChild = useMemo(() => {
    const children = new Map<string, string>();
    for (const row of model)
      if (row.node.parentId && !row.node.componentId) children.set(row.node.parentId, row.node.id);
    return children;
  }, [model]);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const pointerType = useRef("mouse");
  const rows = useMemo(() => getExpandedRows(model, collapsedIds), [model, collapsedIds]);
  const indexById = useMemo(() => new Map(rows.map((row, index) => [row.node.id, index])), [rows]);
  const { viewportRef, width, setScrollTop, range } = useVirtualViewport({
    count: rows.length,
    rowHeight,
    height: viewportHeight,
  });
  const focusedIndex = Math.max(0, focusedId === null ? 0 : (indexById.get(focusedId) ?? 0));
  const activeRow = rows[focusedIndex];
  const focusedIsRendered = focusedIndex >= range.start && focusedIndex < range.end;
  const windowRows = rows.slice(range.start, range.end);
  const renderedRows =
    isFocused && activeRow && !focusedIsRendered ? [...windowRows, activeRow] : windowRows;
  const indentation = getIndentation(rows.slice(range.firstVisible, range.lastVisible), width);
  const branchRows = [...windowRows];
  let ancestorIndex = windowRows[0]?.parentIndex ?? -1;
  while (ancestorIndex >= 0) {
    const ancestor = model[ancestorIndex];
    branchRows.push(ancestor);
    if (ancestor.depth <= indentation.baseDepth) break;
    ancestorIndex = ancestor.parentIndex;
  }
  const windowHeight = windowRows.length * rowHeight;
  const getConnectorY = (nodeId: string) =>
    Math.max(
      -rowHeight,
      Math.min(
        windowHeight + rowHeight,
        (indexById.get(nodeId) ?? 0) * rowHeight + rowHeight / 2 - range.offset,
      ),
    );
  const getItemId = (nodeId: string) => `${treeId}-${encodeURIComponent(nodeId)}`;

  const focusRow = (index: number, shouldScroll = false) => {
    const row = rows[index];
    if (!row) return;
    focusedRef.current = row.node.id;
    setFocusedId(row.node.id);
    if (shouldScroll) interaction.setFocusedId(row.node.id, true);
    const element = viewportRef.current;
    if (shouldScroll && element) {
      const top = index * rowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + rowHeight > element.scrollTop + viewportHeight)
        element.scrollTop = top + rowHeight - viewportHeight;
      setScrollTop(element.scrollTop);
    }
  };

  useLayoutEffect(() => {
    if (isFocused && activeRow && focusedRef.current !== activeRow.node.id)
      focusRow(focusedIndex, true);
  });

  useLayoutEffect(() => {
    if (!revealRequest) return;
    const index = indexById.get(revealRequest.nodeId);
    if (index !== undefined) {
      focusRow(index, true);
      if (revealRequest.shouldFocus) viewportRef.current?.focus({ preventScroll: true });
    }
    setRevealRequest(null);
  }, [revealRequest, rows]);

  const toggleRow = (node: TreeNode) => {
    if (!collapsedIds.has(node.id) && focusedRef.current !== null) {
      const rowIndex = modelIndexById.get(node.id);
      const currentIndex = modelIndexById.get(focusedRef.current);
      if (
        rowIndex !== undefined &&
        currentIndex !== undefined &&
        currentIndex > rowIndex &&
        currentIndex < model[rowIndex].subtreeEnd
      )
        focusRow(indexById.get(node.id) ?? 0, true);
    }
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const activateNode = (node: TreeNode) => {
    if (onSelect) onSelect(node);
    else if (model[modelIndexById.get(node.id) ?? -1]?.hasChildren) toggleRow(node);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !activeRow ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    )
      return;
    const action = getTreeKeyAction(rows, activeRow.node.id, event.key, collapsedIds, direction);
    const nextId =
      action?.focusId ??
      (!action && [...event.key].length === 1
        ? findMatch(rows, activeRow.node.id, event.key)
        : undefined);
    if (!action && !nextId) return;
    event.preventDefault();
    interaction.setHoveredId(null);
    if (action?.clear) {
      interaction.setFocusedId(null);
      return;
    }
    interaction.setFocusedId(activeRow.node.id, true);
    if (nextId) focusRow(indexById.get(nextId) ?? focusedIndex, true);
    if (action?.toggleId) {
      const row = rows[indexById.get(action.toggleId) ?? -1];
      if (row) toggleRow(row.node);
    }
    if (action?.activate && !event.repeat) activateNode(activeRow.node);
  };

  return (
    <DiagramInteractionContext value={interaction}>
      {controls && (
        <TreeTools
          label={label}
          model={model}
          activeId={interaction.activeId}
          reveal={(nodeId, shouldFocus) => {
            setCollapsedIds((previous) => getRevealedTreeIds(model, nodeId, previous));
            setRevealRequest({ nodeId, shouldFocus });
          }}
          expandAll={() => setCollapsedIds(new Set())}
          collapseAll={() => setCollapsedIds(getCollapsedTreeIds(model))}
        />
      )}
      <div
        ref={viewportRef}
        {...stylex.props(
          styles.viewport(viewportHeight),
          isFocusVisible && !activeRow && styles.focus,
        )}
        role={rows.length ? "tree" : "group"}
        aria-label={label}
        aria-describedby={`${treeId}-instructions`}
        tabIndex={0}
        aria-activedescendant={
          activeRow && (focusedIsRendered || isFocused) ? getItemId(activeRow.node.id) : undefined
        }
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          focusProps.onFocus?.(event);
          const index = focusedRef.current === null ? 0 : (indexById.get(focusedRef.current) ?? 0);
          focusRow(index, getIsFocusVisible());
        }}
        onScroll={(event) => {
          interaction.setHoveredId(null);
          setScrollTop(event.currentTarget.scrollTop);
        }}
        onPointerLeave={() => interaction.setHoveredId(null)}
        onBlur={(event) => {
          focusProps.onBlur?.(event);
          interaction.setFocusedId(null);
        }}
        data-base-depth={indentation.baseDepth}
        data-indent-size={indentation.size}
        data-visible-count={range.lastVisible - range.firstVisible}
        data-mounted-count={renderedRows.length}
        data-total-count={nodes.length}
      >
        <span id={`${treeId}-instructions`} {...stylex.props(styles.description)}>
          {treeInstructions}
        </span>
        <div {...stylex.props(styles.spacer(range.totalHeight))} role="presentation">
          <svg
            width={width}
            height={windowHeight}
            textRendering="geometricPrecision"
            {...stylex.props(styles.window(range.offset))}
            role="presentation"
          >
            {branchRows.map((row) =>
              !lastComponentChild.has(row.node.id) || collapsedIds.has(row.node.id) ? null : (
                <path
                  key={`trunk-${row.node.id}`}
                  aria-hidden="true"
                  data-connector="trunk"
                  {...stylex.props(drawing.connector)}
                  d={`M ${getNodeOffset(row.depth, indentation)} ${getConnectorY(row.node.id)} V ${getConnectorY(lastComponentChild.get(row.node.id) ?? row.node.id)}`}
                />
              ),
            )}
            {windowRows.map((row) =>
              row.depth === 0 || row.node.componentId !== undefined ? null : (
                <path
                  key={`branch-${row.node.id}`}
                  aria-hidden="true"
                  data-connector="branch"
                  {...stylex.props(drawing.connector)}
                  d={`M ${getNodeOffset(row.depth - 1, indentation)} ${getConnectorY(row.node.id)} H ${getNodeOffset(row.depth, indentation)}`}
                />
              ),
            )}
            {renderedRows.map((row) => {
              const index = indexById.get(row.node.id) ?? 0;
              const localIndex = index - range.start;
              const isDetail = row.node.componentId !== undefined;
              const offset =
                getNodeOffset(isDetail ? Math.max(0, row.depth - 1) : row.depth, indentation) +
                (isDetail ? diagramMetrics.labelOffset : 0);
              const centerY = localIndex * rowHeight + rowHeight / 2;
              const itemId = getItemId(row.node.id);
              return (
                <g
                  key={row.node.id}
                  {...stylex.props(stylex.defaultMarker())}
                  id={itemId}
                  role="treeitem"
                  aria-label={getNodeName(row.node)}
                  aria-describedby={`${itemId}-description`}
                  aria-level={row.depth + 1}
                  aria-posinset={row.position}
                  aria-setsize={row.siblingCount}
                  aria-expanded={row.hasChildren ? !collapsedIds.has(row.node.id) : undefined}
                  data-focused={(isFocused && activeRow?.node.id === row.node.id) || undefined}
                  data-depth={row.depth}
                  onPointerEnter={() => interaction.setHoveredId(row.node.id)}
                  onPointerMove={() => {
                    interaction.setHoveredId(row.node.id, true);
                  }}
                  onPointerLeave={() => interaction.setHoveredId(null)}
                  onPointerDown={(event) => {
                    pointerType.current = event.pointerType;
                    interaction.setFocusedId(null, false);
                  }}
                  onClick={(event) => {
                    focusRow(index);
                    activateNode(row.node);
                    viewportRef.current?.focus({ preventScroll: true });
                    interaction.setFocusedId(
                      row.node.id,
                      event.detail === 0 || pointerType.current !== "mouse",
                    );
                  }}
                >
                  <desc id={`${itemId}-description`}>{descriptions.get(row.node.id)}</desc>
                  <rect
                    data-row-hitbox
                    x={0}
                    y={localIndex * rowHeight}
                    width={width}
                    height={rowHeight}
                    fill="transparent"
                  />
                  <DiagramNode
                    isInteractive={false}
                    variant={isDetail ? "detail" : "node"}
                    aria-hidden="true"
                    isFocusVisible={isFocusVisible && activeRow?.node.id === row.node.id}
                    hitHeight={rowHeight}
                    node={row.node}
                    x={offset}
                    y={centerY}
                    maxWidth={width - offset - 8}
                  />
                  {row.hasChildren && (
                    <TreeDisclosure
                      nodeId={row.node.id}
                      x={12}
                      y={centerY}
                      height={rowHeight}
                      isExpanded={!collapsedIds.has(row.node.id)}
                      onToggle={(_event, isFocusDriven) => {
                        focusRow(index);
                        toggleRow(row.node);
                        viewportRef.current?.focus({ preventScroll: true });
                        interaction.setFocusedId(row.node.id, isFocusDriven);
                      }}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {rows.length === 0 && <div {...stylex.props(styles.empty)}>No nodes to display.</div>}
      </div>
    </DiagramInteractionContext>
  );
};
